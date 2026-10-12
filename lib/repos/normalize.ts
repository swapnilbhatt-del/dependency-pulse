import { z } from "zod";

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export type ParsedRepo = { ok: true; owner: string; name: string; fullName: string } | { ok: false; error: string };

/**
 * Accepts "owner/name", "github.com/owner/name", "https://github.com/owner/name[/...]",
 * "git@github.com:owner/name.git". Strips trailing slashes and ".git".
 * Validation happens here, before any GitHub API call.
 */
export function parseRepoInput(input: string): ParsedRepo {
  let s = (input ?? "").trim();
  if (!s) return { ok: false, error: "Enter a repository as owner/name or a GitHub URL." };
  if (s.length > 300) return { ok: false, error: "Input is too long." };

  s = s.replace(/^git@github\.com:/i, "github.com/");
  s = s.replace(/^git\+/, "");
  if (/^[a-z]+:\/\//i.test(s) || /^(www\.)?github\.com\//i.test(s)) {
    let url: URL;
    try {
      url = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
      return { ok: false, error: "That URL could not be parsed." };
    }
    if (!/^(www\.)?github\.com$/i.test(url.hostname)) return { ok: false, error: "Only github.com repositories are supported." };
    s = url.pathname;
  }
  s = s.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return { ok: false, error: "Use the form owner/name, for example stripe/stripe-node." };
  const [owner, rawName] = parts;
  const name = rawName.replace(/\.git$/i, "");
  if (!OWNER_RE.test(owner)) return { ok: false, error: `"${owner}" is not a valid GitHub owner name.` };
  if (!NAME_RE.test(name) || name === "." || name === "..") return { ok: false, error: `"${name}" is not a valid repository name.` };
  return { ok: true, owner, name, fullName: `${owner}/${name}` };
}

export const PRIORITIES = ["critical", "normal", "low"] as const;

export const repoUpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  category: z
    .string()
    .trim()
    .max(40)
    .regex(/^[a-z0-9 _-]*$/i, "Use letters, numbers, spaces, dashes or underscores.")
    .transform((v) => v.toLowerCase())
    .optional(),
  priority: z.enum(PRIORITIES).optional(),
  notes: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
});

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

/** Bulk import: one repo per line; blank lines and "#" comments are skipped. */
export function parseBulkInput(text: string): { line: number; input: string; result: ParsedRepo }[] {
  return text
    .split(/\r?\n/)
    .map((raw, i) => ({ line: i + 1, input: raw.trim() }))
    .filter((l) => l.input && !l.input.startsWith("#"))
    .slice(0, 200)
    .map((l) => ({ ...l, result: parseRepoInput(l.input) }));
}
