"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { isAdmin } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { GithubClient } from "@/lib/github/client";
import { healthDeps } from "@/lib/health/deps";
import { refreshAll } from "@/lib/health/refresh";
import { fetchLatestVersion } from "@/lib/health/sources/public";
import * as store from "@/lib/health/store";
import { slugFor } from "@/lib/health/store/rules";
import { errorMessage } from "@/lib/log";
import { parseRepoInput } from "@/lib/repos/normalize";
import { parseCandidateLine } from "@/lib/health/bulk";
import { addRepo, softDeleteRepo, verifyOnGithub } from "@/lib/repos/service";
import type { ActionResult } from "@/app/admin/actions";

async function guard(): Promise<ActionResult | null> {
  return (await isAdmin()) ? null : { ok: false, error: "Your session has expired. Sign in again." };
}
function refreshPages(slug?: string) {
  revalidatePath("/evaluate");
  revalidatePath("/admin/evaluate");
  if (slug) revalidatePath(`/evaluate/${slug}`);
}

const ECOSYSTEMS = ["npm", "pypi"] as const;
const BACKING = ["company-backed", "foundation-backed", "individual", "unknown"] as const;
const STATUSES = ["evaluating", "adopted", "rejected", "parked"] as const;

const packageSchema = z
  .object({ ecosystem: z.enum(ECOSYSTEMS).nullable(), name: z.string().trim().max(214).nullable() })
  .refine((p) => (p.ecosystem === null) === (!p.name), { message: "Choose an ecosystem and enter the package name, or leave both empty." })
  .refine((p) => !p.name || /^(@[a-z0-9][\w.-]*\/)?[A-Za-z0-9][\w.-]*$/.test(p.name), { message: "That package name is not valid." });

const candidateSchema = z.object({
  input: z.string().trim().min(1, "Enter a repository as owner/name or a GitHub URL.").max(300),
  ecosystem: z.enum(ECOSYSTEMS).nullable(),
  packageName: z.string().trim().max(214).nullable(),
  intendedUse: z.string().trim().max(300).default(""),
  sponsorship: z.enum(BACKING).default("unknown"),
});

async function checkPackage(eco: "npm" | "pypi" | null, name: string | null): Promise<string | null> {
  const p = packageSchema.safeParse({ ecosystem: eco, name: name || null });
  if (!p.success) return p.error.issues[0].message;
  if (!eco || !name) return null;
  const v = await fetchLatestVersion(eco, name, {});
  if (v.status.state === "not_available") return `${eco === "npm" ? "npm" : "PyPI"} has no package named "${name}".`;
  return null;
}

/** Validates, checks GitHub and the registry, then saves. Refreshes health right away. */
export async function addCandidateAction(_prev: ActionResult<{ slug: string }> | null, form: FormData): Promise<ActionResult<{ slug: string }>> {
  const denied = await guard();
  if (denied) return denied;
  const parsed = candidateSchema.safeParse({
    input: form.get("input") ?? "",
    ecosystem: form.get("ecosystem") || null,
    packageName: form.get("packageName") || null,
    intendedUse: form.get("intendedUse") ?? "",
    sponsorship: form.get("sponsorship") || "unknown",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0] ?? "input") };
  const repo = parseRepoInput(parsed.data.input);
  if (!repo.ok) return { ok: false, error: repo.error, field: "input" };
  const pkgErr = await checkPackage(parsed.data.ecosystem, parsed.data.packageName);
  if (pkgErr) return { ok: false, error: pkgErr, field: "packageName" };
  const gh = await verifyOnGithub(repo.fullName, new GithubClient({ token: env("GITHUB_TOKEN") ?? "" }));
  if (!gh.ok) return { ok: false, error: gh.error, field: "input" };
  const canonical = gh.info.full_name;
  const existing = await store.findCandidateByName(canonical);
  if (existing && !existing.archivedFromWatchlist) return { ok: false, error: `${canonical} is already on the watchlist.`, field: "input" };
  const [owner, name] = canonical.split("/");
  const row = existing
    ? await store.updateCandidate(existing.id, { archivedFromWatchlist: false, packageEcosystem: parsed.data.ecosystem, packageName: parsed.data.packageName, intendedUse: parsed.data.intendedUse, sponsorshipOrBacking: parsed.data.sponsorship }, "candidate.restore")
    : await store.insertCandidate({ owner, name, fullName: canonical, slug: slugFor(canonical), packageEcosystem: parsed.data.ecosystem, packageName: parsed.data.packageName, intendedUse: parsed.data.intendedUse, sponsorshipOrBacking: parsed.data.sponsorship });
  if (!row) return { ok: false, error: "Could not save the candidate." };
  try {
    await refreshAll(healthDeps(), { trigger: "admin_one", force: true, onlyIds: [row.id] });
  } catch (err) {
    refreshPages(row.slug);
    return { ok: true, message: `${canonical} added. The first health check failed (${errorMessage(err)}); use “Refresh health” to retry.`, data: { slug: row.slug } };
  }
  refreshPages(row.slug);
  return { ok: true, message: `${canonical} added and checked.`, data: { slug: row.slug } };
}

const editSchema = z.object({
  id: z.number().int().positive(),
  intendedUse: z.string().trim().max(300).optional(),
  teamNotes: z.string().trim().max(2000).optional(),
  sponsorship: z.enum(BACKING).optional(),
  notesPublic: z.boolean().optional(),
  ecosystem: z.enum(ECOSYSTEMS).nullable().optional(),
  packageName: z.string().trim().max(214).nullable().optional(),
});

export async function updateCandidateAction(input: z.input<typeof editSchema>): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const p = editSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { id, sponsorship, ecosystem, ...rest } = p.data;
  if (ecosystem !== undefined || rest.packageName !== undefined) {
    const err = await checkPackage(ecosystem ?? null, rest.packageName ?? null);
    if (err) return { ok: false, error: err };
  }
  const row = await store.updateCandidate(id, {
    ...rest,
    ...(sponsorship ? { sponsorshipOrBacking: sponsorship } : {}),
    ...(ecosystem !== undefined ? { packageEcosystem: ecosystem } : {}),
  });
  if (!row) return { ok: false, error: "Candidate not found." };
  refreshPages(row.slug);
  return { ok: true, message: `${row.fullName} saved.` };
}

const decisionSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(STATUSES),
  reason: z.string().trim().min(5, "Give a reason of at least a few words.").max(1000),
  decidedBy: z.string().trim().min(2, "Enter who made the decision.").max(80),
});

export async function recordDecisionAction(input: z.input<typeof decisionSchema>): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const p = decisionSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const c = await store.getCandidate(p.data.id);
  if (!c) return { ok: false, error: "Candidate not found." };
  await store.recordDecision(p.data.id, p.data.status, p.data.reason, p.data.decidedBy);
  refreshPages(c.slug);
  return { ok: true, message: `Decision recorded for ${c.fullName}.` };
}

export async function refreshCandidateAction(id: number): Promise<ActionResult<{ verdict: string }>> {
  const denied = await guard();
  if (denied) return denied;
  const c = await store.getCandidate(id);
  if (!c) return { ok: false, error: "Candidate not found." };
  await audit("candidate.refresh", c.fullName, {});
  const r = await refreshAll(healthDeps(), { trigger: "admin_one", force: true, onlyIds: [id] });
  refreshPages(c.slug);
  const res = r.progress.results[c.fullName];
  if (!res || res.verdict === "error") return { ok: false, error: `Refresh failed: ${res?.error ?? r.status}` };
  return { ok: true, message: res.note ?? `${c.fullName} refreshed.`, data: { verdict: res.verdict } };
}

export async function refreshAllAction(): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  await audit("candidate.refresh_all", "watchlist", {});
  const r = await refreshAll(healthDeps(), { trigger: "admin_all", force: true });
  refreshPages();
  if (r.status === "continue") return { ok: false, error: `${r.remaining} candidates are still waiting; click “Refresh all” again to continue (finished ones are kept).` };
  return r.status === "failed" ? { ok: false, error: "Refresh failed. See the run list below." } : { ok: true, message: `Refreshed ${Object.keys(r.progress.results).length} candidates.` };
}

export async function setArchivedAction(id: number, archived: boolean): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const row = await store.updateCandidate(id, { archivedFromWatchlist: archived }, archived ? "candidate.archive" : "candidate.restore");
  if (!row) return { ok: false, error: "Candidate not found." };
  refreshPages(row.slug);
  return { ok: true, message: archived ? `${row.fullName} removed from the watchlist (history kept).` : `${row.fullName} is back on the watchlist.` };
}

/** Adds the candidate to the live dependency list (the Monday digest) and takes it off the watchlist. */
export async function moveToDependenciesAction(id: number, category: string, priority: "critical" | "normal" | "low"): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const c = await store.getCandidate(id);
  if (!c) return { ok: false, error: "Candidate not found." };
  const r = await addRepo(c.fullName, { category: category.trim().toLowerCase().slice(0, 40) || "evaluation", priority, notes: c.intendedUse.slice(0, 500) });
  if (!r.ok && !/already tracked/.test(r.error)) return { ok: false, error: r.error };
  await store.updateCandidate(id, { archivedFromWatchlist: true }, "candidate.move_to_dependencies");
  refreshPages(c.slug);
  revalidatePath("/admin");
  return { ok: true, message: `${c.fullName} now appears in the Monday digest and has left the watchlist.` };
}

/** Moves a live dependency back to evaluation: removed from the digest (soft delete), added to the watchlist. */
export async function moveFromDependenciesAction(repoId: number, fullName: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const existing = await store.findCandidateByName(fullName);
  const [owner, name] = fullName.split("/");
  if (existing) await store.updateCandidate(existing.id, { archivedFromWatchlist: false }, "candidate.move_from_dependencies");
  else {
    const c = await store.insertCandidate({ owner, name, fullName, slug: slugFor(fullName) });
    await audit("candidate.move_from_dependencies", c.fullName, {});
  }
  const del = await softDeleteRepo(repoId);
  if (!del.ok) return { ok: false, error: del.error ?? "Could not remove it from the dependency list." };
  refreshPages();
  revalidatePath("/admin");
  return { ok: true, message: `${fullName} moved to the evaluation watchlist and removed from the Monday digest.` };
}

export async function setEmailWatchlistAction(enabled: boolean): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  await store.setSetting(store.EMAIL_WATCHLIST_FLAG, enabled);
  revalidatePath("/admin/evaluate");
  return { ok: true, message: enabled ? "The Monday email will include the Evaluation watchlist." : "The Evaluation watchlist is no longer included in the Monday email." };
}

// ── Bulk import ──────────────────────────────────────────────────────────────
export interface CandidateLine {
  line: number;
  input: string;
  status: "valid" | "invalid" | "duplicate" | "not_found";
  fullName?: string;
  ecosystem?: "npm" | "pypi" | null;
  packageName?: string | null;
  intendedUse?: string;
  message: string;
}

export async function validateCandidatesBulkAction(text: string): Promise<ActionResult<CandidateLine[]>> {
  const denied = await guard();
  if (denied) return denied;
  if (typeof text !== "string" || text.length > 20_000) return { ok: false, error: "Paste at most 100 lines." };
  const lines = text.split(/\r?\n/).map((s, i) => ({ line: i + 1, input: s.trim() })).filter((l) => l.input && !l.input.startsWith("#")).slice(0, 100);
  const gh = new GithubClient({ token: env("GITHUB_TOKEN") ?? "" });
  const existing = new Set((await store.listCandidates()).map((c) => c.fullName.toLowerCase()));
  const seen = new Set<string>();
  const out: CandidateLine[] = [];
  for (const l of lines) {
    const p = parseCandidateLine(l.input);
    const repo = parseRepoInput(p.repo);
    if (!repo.ok) {
      out.push({ line: l.line, input: l.input, status: "invalid", message: repo.error });
      continue;
    }
    const pkgErr = packageSchema.safeParse({ ecosystem: p.ecosystem, name: p.packageName });
    if (!pkgErr.success) {
      out.push({ line: l.line, input: l.input, status: "invalid", message: pkgErr.error.issues[0].message });
      continue;
    }
    const key = repo.fullName.toLowerCase();
    if (existing.has(key) || seen.has(key)) {
      out.push({ line: l.line, input: l.input, status: "duplicate", fullName: repo.fullName, message: existing.has(key) ? "Already on the watchlist." : "Listed twice." });
      continue;
    }
    seen.add(key);
    const check = await verifyOnGithub(repo.fullName, gh);
    out.push(
      check.ok
        ? { line: l.line, input: l.input, status: "valid", fullName: check.info.full_name, ecosystem: p.ecosystem, packageName: p.packageName, intendedUse: p.intendedUse, message: `Found on GitHub${p.packageName ? ` · ${p.ecosystem}: ${p.packageName}` : ""}.` }
        : { line: l.line, input: l.input, status: "not_found", fullName: repo.fullName, message: check.error },
    );
  }
  return { ok: true, message: `${out.filter((o) => o.status === "valid").length} of ${out.length} lines can be imported.`, data: out };
}

export async function importCandidatesBulkAction(rows: { fullName: string; ecosystem: "npm" | "pypi" | null; packageName: string | null; intendedUse: string }[]): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const p = z.array(z.object({ fullName: z.string().max(200), ecosystem: z.enum(ECOSYSTEMS).nullable(), packageName: z.string().max(214).nullable(), intendedUse: z.string().max(300) })).max(100).safeParse(rows);
  if (!p.success) return { ok: false, error: "Invalid import list." };
  let added = 0;
  for (const r of p.data) {
    if (!parseRepoInput(r.fullName).ok || (await store.findCandidateByName(r.fullName))) continue;
    const [owner, name] = r.fullName.split("/");
    await store.insertCandidate({ owner, name, fullName: r.fullName, slug: slugFor(r.fullName), packageEcosystem: r.ecosystem, packageName: r.packageName, intendedUse: r.intendedUse });
    added++;
  }
  refreshPages();
  return { ok: true, message: `Added ${added} ${added === 1 ? "candidate" : "candidates"}. Use “Refresh all” to check their health.` };
}
