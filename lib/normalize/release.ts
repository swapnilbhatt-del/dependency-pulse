import { z } from "zod";
import { DB_BODY_MAX_CHARS } from "@/lib/config";
import type { NormalizedRelease } from "@/lib/types";
import { safeGithubUrl, sha256, truncate } from "@/lib/util";

/** The subset of the GitHub release payload we rely on. Anything else is ignored. */
export const githubReleaseSchema = z.object({
  id: z.number().int(),
  tag_name: z.string().min(1),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  created_at: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  html_url: z.string(),
});
export type GithubRelease = z.infer<typeof githubReleaseSchema>;

export interface RepoContext {
  repoId: number;
  repoFullName: string;
}

/**
 * Remove noise that carries no information for a reader: HTML comments,
 * contributor shout-outs, "Full Changelog" compare links, trailing whitespace,
 * and runs of blank lines.
 */
export function cleanReleaseBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => !/^\s*[*-]?\s*@[\w-]+ made their first contribution/i.test(line))
    .filter((line) => !/^\s*\**Full Changelog\**:?\s*\**\s*https?:\/\/\S+\s*$/i.test(line))
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Returns null for payloads that are not GitHub releases (issues, PRs, commits, events...). */
export function normalizeRelease(raw: unknown, ctx: RepoContext): NormalizedRelease | null {
  const parsed = githubReleaseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  // A release html_url always points at /releases/tag/...; reject anything else.
  const url = safeGithubUrl(r.html_url);
  if (!url || !/\/releases\/tag\//.test(url)) return null;
  const when = r.published_at ?? r.created_at;
  if (!when) return null;
  const publishedAt = new Date(when);
  if (Number.isNaN(publishedAt.getTime())) return null;

  const rawBody = r.body ?? "";
  const cleaned = cleanReleaseBody(rawBody);
  const { text, truncated } = truncate(cleaned, DB_BODY_MAX_CHARS);
  return {
    repoId: ctx.repoId,
    repoFullName: ctx.repoFullName,
    source: "github_release",
    githubReleaseId: r.id,
    tagName: r.tag_name,
    name: (r.name ?? "").trim() || r.tag_name,
    publishedAt,
    prerelease: r.prerelease,
    draft: r.draft,
    body: text,
    bodyTruncated: truncated,
    notesAvailable: cleaned.length > 0,
    bodyHash: sha256(cleaned),
    htmlUrl: url,
  };
}

export interface TagWithDate {
  name: string;
  commitSha: string;
  commitDate: Date;
}

/** Tag-fallback entries never have notes, and are clearly marked with source = "tag". */
export function normalizeTag(tag: TagWithDate, ctx: RepoContext): NormalizedRelease {
  const [owner, repo] = ctx.repoFullName.split("/");
  return {
    repoId: ctx.repoId,
    repoFullName: ctx.repoFullName,
    source: "tag",
    githubReleaseId: null,
    tagName: tag.name,
    name: tag.name,
    publishedAt: tag.commitDate,
    prerelease: false,
    draft: false,
    body: "",
    bodyTruncated: false,
    notesAvailable: false,
    bodyHash: sha256(`tag:${tag.commitSha}`),
    htmlUrl: `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(tag.name)}`,
  };
}
