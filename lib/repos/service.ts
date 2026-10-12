import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { GithubClient, GithubError } from "@/lib/github/client";
import { parseRepoInput, repoUpdateSchema } from "@/lib/repos/normalize";
import type { RepoRef, RepoStatus } from "@/lib/types";

export type RepoRow = typeof schema.repos.$inferSelect;

export function toRef(r: RepoRow): RepoRef {
  return { id: r.id, owner: r.owner, name: r.name, fullName: r.fullName, category: r.category, priority: r.priority, enabled: r.enabled };
}

export async function listRepos(): Promise<RepoRow[]> {
  return getDb().select().from(schema.repos).where(isNull(schema.repos.deletedAt)).orderBy(asc(sql`lower(${schema.repos.fullName})`));
}

export async function listEnabledRepos(): Promise<RepoRef[]> {
  const rows = await getDb()
    .select()
    .from(schema.repos)
    .where(and(isNull(schema.repos.deletedAt), eq(schema.repos.enabled, true)))
    .orderBy(asc(schema.repos.id));
  return rows.map(toRef);
}

export type AddRepoResult = { ok: true; repo: RepoRow; restored: boolean } | { ok: false; error: string; field?: "input" };

interface GithubRepoInfo {
  full_name: string;
  private: boolean;
  archived: boolean;
  owner: { login: string };
  name: string;
}

/** Confirms the repo exists and is publicly readable; returns GitHub's canonical owner/name (follows renames). */
export async function verifyOnGithub(fullName: string, gh?: GithubClient): Promise<{ ok: true; info: GithubRepoInfo } | { ok: false; error: string }> {
  const client = gh ?? new GithubClient({ token: env("GITHUB_TOKEN") ?? "" });
  try {
    const res = await client.get<GithubRepoInfo>(`/repos/${fullName}`);
    if (res.data.private) return { ok: false, error: "That repository is private. Only public repositories can be tracked." };
    return { ok: true, info: res.data };
  } catch (err) {
    if (err instanceof GithubError && err.kind === "not_found") return { ok: false, error: `${fullName} was not found on GitHub, or it is private.` };
    if (err instanceof GithubError && err.kind === "rate_limited") return { ok: false, error: "GitHub rate limit reached. Try again in a few minutes." };
    return { ok: false, error: err instanceof Error ? err.message : "GitHub check failed." };
  }
}

export async function addRepo(
  input: string,
  meta: { category?: string; priority?: "critical" | "normal" | "low"; notes?: string } = {},
  gh?: GithubClient,
): Promise<AddRepoResult> {
  const parsed = parseRepoInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error, field: "input" };
  const check = await verifyOnGithub(parsed.fullName, gh);
  if (!check.ok) return { ok: false, error: check.error, field: "input" };
  const canonical = check.info.full_name;
  const [owner, name] = canonical.split("/");
  const db = getDb();
  const existing = await db.select().from(schema.repos).where(sql`lower(${schema.repos.fullName}) = lower(${canonical})`).limit(1);
  const category = (meta.category ?? "").trim().toLowerCase().slice(0, 40);
  if (existing[0] && !existing[0].deletedAt) return { ok: false, error: `${canonical} is already tracked.`, field: "input" };
  if (existing[0]) {
    const [row] = await db
      .update(schema.repos)
      .set({ deletedAt: null, enabled: true, ...(category ? { category } : {}), ...(meta.priority ? { priority: meta.priority } : {}) })
      .where(eq(schema.repos.id, existing[0].id))
      .returning();
    await audit("repo.restore", canonical, { input });
    return { ok: true, repo: row, restored: true };
  }
  const [row] = await db
    .insert(schema.repos)
    .values({ owner, name, fullName: canonical, category, priority: meta.priority ?? "normal", notes: (meta.notes ?? "").slice(0, 500) })
    .returning();
  await audit("repo.add", canonical, { input, category, priority: meta.priority ?? "normal", renamed: canonical.toLowerCase() !== parsed.fullName.toLowerCase() ? parsed.fullName : undefined });
  return { ok: true, repo: row, restored: false };
}

export async function updateRepo(raw: unknown): Promise<{ ok: true; repo: RepoRow } | { ok: false; error: string }> {
  const parsed = repoUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { id, ...changes } = parsed.data;
  const patch = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update." };
  const [row] = await getDb()
    .update(schema.repos)
    .set(patch)
    .where(and(eq(schema.repos.id, id), isNull(schema.repos.deletedAt)))
    .returning();
  if (!row) return { ok: false, error: "Repository not found." };
  await audit("repo.update", row.fullName, patch);
  return { ok: true, repo: row };
}

export async function softDeleteRepo(id: number): Promise<{ ok: boolean; error?: string }> {
  const [row] = await getDb()
    .update(schema.repos)
    .set({ deletedAt: new Date(), enabled: false })
    .where(and(eq(schema.repos.id, id), isNull(schema.repos.deletedAt)))
    .returning();
  if (!row) return { ok: false, error: "Repository not found." };
  await audit("repo.delete", row.fullName, { soft: true });
  return { ok: true };
}

export async function recordRepoStatuses(results: { id: number; status: RepoStatus; error: string | null }[], at: Date): Promise<void> {
  if (!results.length) return;
  await getDb().transaction(async (tx) => {
    for (const r of results) {
      await tx
        .update(schema.repos)
        .set({ lastCheckedAt: at, lastStatus: r.status, lastError: r.error ? r.error.slice(0, 500) : null })
        .where(eq(schema.repos.id, r.id));
    }
  });
}
