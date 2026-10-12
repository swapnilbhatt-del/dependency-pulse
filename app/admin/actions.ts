"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { attemptLogin, endSession, isAdmin } from "@/lib/auth/session";
import { addRecipient, removeRecipient } from "@/lib/delivery/recipients";
import { env } from "@/lib/env";
import { GithubClient } from "@/lib/github/client";
import { ISO_WEEK_PATTERN } from "@/lib/filter/window";
import { errorMessage } from "@/lib/log";
import { productionDeps } from "@/lib/pipeline/deps";
import { resendStoredDigest, runWeeklyDigest } from "@/lib/pipeline/run";
import { PRIORITIES, parseBulkInput, parseRepoInput } from "@/lib/repos/normalize";
import { addRepo, listRepos, softDeleteRepo, updateRepo, verifyOnGithub } from "@/lib/repos/service";

export type ActionResult<T = undefined> = { ok: true; message: string; data?: T } | { ok: false; error: string; field?: string };

async function guard(): Promise<ActionResult | null> {
  if (!(await isAdmin())) return { ok: false, error: "Your session has expired. Sign in again." };
  return null;
}

function refreshPublic() {
  revalidatePath("/");
  revalidatePath("/archive");
  revalidatePath("/digest/[isoWeek]", "page");
}

// ── Session ───────────────────────────────────────────────────────────────────
export async function loginAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const password = String(form.get("password") ?? "");
  if (!password) return { ok: false, error: "Enter the admin password.", field: "password" };
  if (password.length > 512) return { ok: false, error: "That password is not correct.", field: "password" };
  let result: Awaited<ReturnType<typeof attemptLogin>>;
  try {
    result = await attemptLogin(password);
  } catch (err) {
    return { ok: false, error: `Sign-in is unavailable: ${errorMessage(err).slice(0, 120)}` };
  }
  if (!result.ok) return { ok: false, error: result.error, field: "password" };
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/admin/login");
}

// ── Repositories ──────────────────────────────────────────────────────────────
const addSchema = z.object({
  input: z.string().trim().min(1, "Enter a repository as owner/name or a GitHub URL.").max(300),
  category: z.string().trim().max(40).regex(/^[a-z0-9 _-]*$/i, "Use letters, numbers, spaces, dashes or underscores.").optional(),
  priority: z.enum(PRIORITIES).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function addRepoAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const parsed = addSchema.safeParse({
    input: form.get("input") ?? "",
    category: form.get("category") || undefined,
    priority: form.get("priority") || undefined,
    notes: form.get("notes") || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Invalid input.", field: String(issue?.path[0] ?? "input") };
  }
  const res = await addRepo(parsed.data.input, parsed.data);
  if (!res.ok) return { ok: false, error: res.error, field: "input" };
  revalidatePath("/admin");
  return { ok: true, message: res.restored ? `${res.repo.fullName} restored and enabled.` : `${res.repo.fullName} added. It will be checked in the next run.` };
}

export async function updateRepoAction(input: { id: number; category?: string; priority?: string; notes?: string; enabled?: boolean }): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const res = await updateRepo(input);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/admin");
  const what = input.enabled !== undefined ? (input.enabled ? "enabled" : "disabled") : "saved";
  return { ok: true, message: `${res.repo.fullName} ${what}.` };
}

export async function deleteRepoAction(id: number): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Invalid repository." };
  const res = await softDeleteRepo(id);
  if (!res.ok) return { ok: false, error: res.error ?? "Could not remove the repository." };
  revalidatePath("/admin");
  return { ok: true, message: "Repository removed. Its history is kept; add it again to restore it." };
}

export interface BulkLineResult {
  line: number;
  input: string;
  status: "valid" | "invalid" | "duplicate" | "not_found";
  fullName?: string;
  message: string;
}

/** Live per-line validation preview for the bulk import dialog. Checks format, duplicates and GitHub existence. */
export async function validateBulkAction(text: string): Promise<ActionResult<BulkLineResult[]>> {
  const denied = await guard();
  if (denied) return denied;
  if (typeof text !== "string" || text.length > 20_000) return { ok: false, error: "Paste at most 200 lines." };
  const lines = parseBulkInput(text);
  const existing = new Set((await listRepos()).map((r) => r.fullName.toLowerCase()));
  const seen = new Set<string>();
  const gh = new GithubClient({ token: env("GITHUB_TOKEN") ?? "" });
  const out: BulkLineResult[] = [];
  for (const l of lines) {
    if (!l.result.ok) {
      out.push({ line: l.line, input: l.input, status: "invalid", message: l.result.error });
      continue;
    }
    const key = l.result.fullName.toLowerCase();
    if (existing.has(key) || seen.has(key)) {
      out.push({ line: l.line, input: l.input, status: "duplicate", fullName: l.result.fullName, message: existing.has(key) ? "Already tracked." : "Listed twice." });
      continue;
    }
    seen.add(key);
    const check = await verifyOnGithub(l.result.fullName, gh);
    if (!check.ok) out.push({ line: l.line, input: l.input, status: "not_found", fullName: l.result.fullName, message: check.error });
    else {
      const renamed = check.info.full_name.toLowerCase() !== key;
      out.push({ line: l.line, input: l.input, status: "valid", fullName: check.info.full_name, message: renamed ? `Found (now ${check.info.full_name}).` : "Found on GitHub." });
    }
  }
  return { ok: true, message: `${out.filter((o) => o.status === "valid").length} of ${out.length} lines can be imported.`, data: out };
}

export async function importBulkAction(fullNames: string[], meta: { category?: string; priority?: string }): Promise<ActionResult<{ added: string[]; failed: { name: string; error: string }[] }>> {
  const denied = await guard();
  if (denied) return denied;
  const names = z.array(z.string().max(200)).max(200).safeParse(fullNames);
  if (!names.success) return { ok: false, error: "Invalid import list." };
  const m = z.object({ category: z.string().trim().max(40).optional(), priority: z.enum(PRIORITIES).optional() }).safeParse(meta);
  if (!m.success) return { ok: false, error: "Invalid category or priority." };
  const gh = new GithubClient({ token: env("GITHUB_TOKEN") ?? "" });
  const added: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const n of names.data) {
    if (!parseRepoInput(n).ok) {
      failed.push({ name: n, error: "Invalid name." });
      continue;
    }
    const r = await addRepo(n, m.data, gh);
    if (r.ok) added.push(r.repo.fullName);
    else failed.push({ name: n, error: r.error });
  }
  await audit("repo.bulk_import", "repos", { added: added.length, failed: failed.length });
  revalidatePath("/admin");
  return { ok: true, message: `Imported ${added.length} ${added.length === 1 ? "repository" : "repositories"}${failed.length ? `, ${failed.length} skipped` : ""}.`, data: { added, failed } };
}

// ── Recipients ────────────────────────────────────────────────────────────────
export async function addRecipientAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const res = await addRecipient(String(form.get("email") ?? ""));
  if (!res.ok) return { ok: false, error: res.error, field: "email" };
  revalidatePath("/admin/recipients");
  return { ok: true, message: `${res.row.email} will receive the Monday digest.` };
}

export async function removeRecipientAction(id: number): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const res = await removeRecipient(id);
  revalidatePath("/admin/recipients");
  return res.ok ? { ok: true, message: "Recipient removed." } : { ok: false, error: "Recipient not found." };
}

// ── Runs ──────────────────────────────────────────────────────────────────────
export async function runPreviewAction(): Promise<ActionResult<{ runId: string }>> {
  const denied = await guard();
  if (denied) return denied;
  await audit("run.preview", "pipeline", {});
  const r = await runWeeklyDigest(productionDeps(), { trigger: "preview" });
  revalidatePath("/admin/runs");
  if (r.status === "preview") return { ok: true, message: `Preview ready: ${r.model.statusLine}.`, data: { runId: r.runId } };
  if (r.status === "failed") return { ok: false, error: `Preview failed: ${r.error}` };
  return { ok: false, error: `Preview did not complete (${r.status}).` };
}

export async function sendNowAction(force: boolean): Promise<ActionResult<{ isoWeek: string }>> {
  const denied = await guard();
  if (denied) return denied;
  await audit("run.send_now", "pipeline", { force });
  const r = await runWeeklyDigest(productionDeps(), { trigger: "send", force });
  revalidatePath("/admin/runs");
  refreshPublic();
  switch (r.status) {
    case "sent":
      return { ok: true, message: `Digest for ${r.isoWeek} sent.`, data: { isoWeek: r.isoWeek } };
    case "partial":
      return { ok: false, error: `Digest for ${r.isoWeek} saved, but some emails failed: ${r.error}` };
    case "skipped":
      return r.reason === "already_sent"
        ? { ok: false, error: `The digest for ${r.isoWeek} was already sent. Use “Regenerate and resend” to send it again.` }
        : { ok: false, error: `Another run for ${r.isoWeek} is in progress. Try again in a few minutes.` };
    case "continue":
      return { ok: false, error: `The run needs more time (${r.pending} releases left to summarize). Click “Send digest now” again to continue; finished work is cached.` };
    case "failed":
      return { ok: false, error: `Run failed: ${r.error}` };
    default:
      return { ok: false, error: "Unexpected result." };
  }
}

/** Regenerates this week's published digest with current rules, without emailing anyone. */
export async function rebuildWeekAction(): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  await audit("run.rebuild", "pipeline", {});
  const r = await runWeeklyDigest(productionDeps(), { trigger: "rebuild" });
  revalidatePath("/admin/runs");
  refreshPublic();
  if (r.status === "rebuilt") return { ok: true, message: `Digest page for ${r.isoWeek} rebuilt. No email was sent.` };
  if (r.status === "skipped") return { ok: false, error: `Another run for ${r.isoWeek} is in progress. Try again in a few minutes.` };
  if (r.status === "continue") return { ok: false, error: "The rebuild needs more time; click again to continue from the cache." };
  return { ok: false, error: "error" in r && r.error ? `Rebuild failed: ${r.error}` : "Rebuild failed." };
}

export async function resendWeekAction(isoWeek: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  if (!ISO_WEEK_PATTERN.test(isoWeek)) return { ok: false, error: "Invalid week." };
  await audit("run.resend", isoWeek, {});
  const r = await resendStoredDigest(productionDeps(), isoWeek);
  revalidatePath("/admin/runs");
  if (r.status === "sent") return { ok: true, message: `Digest for ${isoWeek} resent.` };
  return { ok: false, error: "error" in r && r.error ? r.error : "Resend failed." };
}
