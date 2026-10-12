"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/app/admin/actions";
import {
  addCandidateAction,
  importCandidatesBulkAction,
  moveToDependenciesAction,
  recordDecisionAction,
  refreshAllAction,
  refreshCandidateAction,
  setArchivedAction,
  setEmailWatchlistAction,
  updateCandidateAction,
  validateCandidatesBulkAction,
  type CandidateLine,
} from "@/app/admin/evaluate-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { VerdictChip } from "@/components/health/verdict";
import { IconCheck, IconX } from "@/components/icons";
import { useToast } from "@/components/toast";
import { ADOPTION_STATUS_LABEL, BACKING_LABEL } from "@/lib/health/labels";
import type { SourceStatus, Verdict } from "@/lib/health/types";

export interface AdminCandidate {
  id: number;
  slug: string;
  fullName: string;
  intendedUse: string;
  packageEcosystem: "npm" | "pypi" | null;
  packageName: string | null;
  sponsorship: keyof typeof BACKING_LABEL;
  teamNotes: string;
  notesPublic: boolean;
  adoptionStatus: keyof typeof ADOPTION_STATUS_LABEL;
  isExample: boolean;
  verdict: Verdict | null;
  score: number | null;
  lastChecked: string | null;
  sources: Partial<Record<string, SourceStatus>>;
  refreshNote: string | null;
}

const SOURCE_LABEL: Record<string, string> = { github: "GitHub", scorecard: "Scorecard", osv: "OSV", npm: "npm", pypi: "PyPI" };
const STATE: Record<string, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "chip-ok" },
  not_available: { label: "Not available", cls: "chip-dashed" },
  rate_limited: { label: "Rate limited", cls: "chip-review" },
  error: { label: "Error", cls: "chip-act" },
};

function SourceChips({ sources }: { sources: AdminCandidate["sources"] }) {
  const entries = Object.entries(sources);
  if (!entries.length) return <span className="text-xs text-ink-3">Not checked yet</span>;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Source status">
      {entries.map(([k, s]) => (
        <li key={k} className={`chip ${STATE[s?.state ?? "error"].cls}`} title={s?.reason ?? undefined}>
          {SOURCE_LABEL[k] ?? k}: {STATE[s?.state ?? "error"].label}
        </li>
      ))}
    </ul>
  );
}

export function CandidateManager({ candidates, emailEnabled }: { candidates: AdminCandidate[]; emailEnabled: boolean }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminCandidate | null>(null);
  const [deciding, setDeciding] = useState<AdminCandidate | null>(null);
  const [moving, setMoving] = useState<AdminCandidate | null>(null);
  const [archiving, setArchiving] = useState<AdminCandidate | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [flag, setFlag] = useState(emailEnabled);

  const act = (key: string, fn: () => Promise<ActionResult<unknown>>) => {
    setBusy(key);
    start(async () => {
      const r = await fn();
      if (r.ok) toast.push("success", r.message);
      else toast.push("error", r.error);
      setBusy(null);
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[2.5rem] leading-tight">Adoption Check</h1>
          <p className="mt-1 text-sm text-ink-2">
            Projects under evaluation, separate from the live dependency list. <Link href="/evaluate">View the public watchlist</Link>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => setBulkOpen(true)}>
            Bulk import
          </button>
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => act("all", refreshAllAction)} aria-describedby="refresh-all-note">
            {busy === "all" ? "Refreshing all candidates…" : "Refresh all"}
          </button>
        </div>
      </div>
      <p id="refresh-all-note" className="sr-only">
        Refreshing all candidates can take about 15 seconds per candidate.
      </p>
      {busy === "all" && <RefreshProgress label="all candidates" />}

      <AddCandidateForm />

      <section aria-labelledby="email-flag" className="card mt-6 flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        <div className="max-w-xl">
          <h2 id="email-flag" className="font-semibold">
            Evaluation watchlist in the Monday email
          </h2>
          <p className="mt-1 text-sm text-ink-2">Adds a compact list of candidates with their verdict, score, top reason and a link, after the existing digest sections. The rest of the email does not change. Off by default.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={flag}
          className="switch"
          aria-label={`${flag ? "Turn off" : "Turn on"} the Evaluation watchlist in the Monday email`}
          data-testid="email-flag"
          onClick={() => {
            const next = !flag;
            setFlag(next);
            start(async () => {
              const r = await setEmailWatchlistAction(next);
              if (r.ok) toast.push("success", r.message);
              else {
                setFlag(!next);
                toast.push("error", r.error);
              }
            });
          }}
        >
          <span className="switch-track" />
        </button>
      </section>

      {candidates.length === 0 ? (
        <div className="card mt-6 p-6">
          <h2 className="font-semibold">No candidates on the watchlist</h2>
          <p className="mt-1 text-ink-2">Add the first one above, or paste a list with Bulk import.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3" aria-busy={pending}>
          {candidates.map((c) => (
            <li key={c.id} className="card p-4 sm:p-5" data-testid="admin-candidate" data-candidate={c.fullName}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold break-all">
                    <Link href={`/evaluate/${c.slug}`}>{c.fullName}</Link>
                  </h2>
                  <p className="text-sm text-ink-2">
                    {c.intendedUse || <span className="text-ink-3">No intended use</span>}
                    {c.packageName ? <span className="text-ink-3"> · {c.packageEcosystem === "pypi" ? "PyPI" : "npm"}: {c.packageName}</span> : <span className="text-ink-3"> · no package</span>}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <VerdictChip verdict={c.verdict} />
                    {c.score !== null && <span className="chip tabular">Score {c.score}</span>}
                    <span className="chip">{ADOPTION_STATUS_LABEL[c.adoptionStatus]}</span>
                    <span className="chip">{BACKING_LABEL[c.sponsorship]}</span>
                    {c.notesPublic ? <span className="chip">Notes public</span> : <span className="chip">Notes private</span>}
                    {c.isExample && <span className="chip chip-dashed">Example</span>}
                  </div>
                  <div className="mt-2">
                    <SourceChips sources={c.sources} />
                  </div>
                  {c.refreshNote && <p className="mt-2 text-xs text-review">{c.refreshNote}</p>}
                  <p className="mt-1 text-xs text-ink-3 tabular">{c.lastChecked ? `Last checked ${new Date(c.lastChecked).toISOString().replace("T", " ").slice(0, 16)} UTC` : "Not checked yet"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => act(`r${c.id}`, () => refreshCandidateAction(c.id))}>
                    {busy === `r${c.id}` ? "Refreshing…" : "Refresh health"}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeciding(c)}>
                    Record decision
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(c)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMoving(c)}>
                    Move to dependencies
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm text-act" onClick={() => setArchiving(c)} aria-label={`Remove ${c.fullName} from the watchlist`}>
                    Remove
                  </button>
                </div>
              </div>
              {busy === `r${c.id}` && <RefreshProgress label={c.fullName} hasPackage={Boolean(c.packageName)} />}
            </li>
          ))}
        </ul>
      )}

      {editing && <EditDialog c={editing} onClose={() => setEditing(null)} />}
      {deciding && <DecisionDialog c={deciding} onClose={() => setDeciding(null)} />}
      {moving && <MoveDialog c={moving} onClose={() => setMoving(null)} />}
      <ConfirmDialog
        open={archiving !== null}
        title={`Remove ${archiving?.fullName ?? ""} from the watchlist?`}
        body={<p>It disappears from the watchlist and weekly refresh. Its snapshots and decisions are kept, and adding it again restores it.</p>}
        confirmLabel="Remove from watchlist"
        pending={pending}
        onCancel={() => setArchiving(null)}
        onConfirm={() => {
          const c = archiving!;
          setArchiving(null);
          act(`a${c.id}`, () => setArchivedAction(c.id, true));
        }}
      />
      <BulkCandidatesDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  );
}

/** Progress for a refresh: the sources being queried, in order. */
function RefreshProgress({ label, hasPackage = true }: { label: string; hasPackage?: boolean }) {
  const steps = ["GitHub: releases, commits, issues and PRs", "OpenSSF Scorecard", ...(hasPackage ? ["OSV vulnerabilities", "Registry downloads"] : []), "Scoring and summary"];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 3500);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3" role="status" aria-live="polite">
      <p className="text-sm font-semibold">Refreshing {label}</p>
      <ol className="mt-1.5 space-y-1 text-sm">
        {steps.map((s, k) => (
          <li key={s} className={`flex items-center gap-2 ${k < i ? "text-ok" : k === i ? "text-ink" : "text-ink-3"}`}>
            <span aria-hidden="true">{k < i ? <IconCheck size={12} /> : k === i ? "…" : "·"}</span>
            {s}
            <span className="sr-only">{k < i ? "(done)" : k === i ? "(in progress)" : "(waiting)"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return { ref, onCancel: (e: React.SyntheticEvent) => (e.preventDefault(), onClose()) };
}

function AddCandidateForm() {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionResult<{ slug: string }> | null, FormData>(addCandidateAction, null);
  const [clientError, setClientError] = useState<{ field: string; msg: string } | null>(null);
  useEffect(() => {
    if (state?.ok) {
      toast.push("success", state.message);
      formRef.current?.reset();
    }
  }, [state, toast]);
  const err = clientError ?? (state && !state.ok ? { field: state.field ?? "input", msg: state.error } : null);
  return (
    <form
      ref={formRef}
      action={action}
      className="card lift mt-6 p-4 sm:p-5"
      aria-labelledby="add-candidate"
      noValidate
      onSubmit={(e) => {
        const f = new FormData(e.currentTarget);
        const repo = String(f.get("input") ?? "").trim();
        const eco = String(f.get("ecosystem") ?? "");
        const pkg = String(f.get("packageName") ?? "").trim();
        if (!repo) return e.preventDefault(), setClientError({ field: "input", msg: "Enter a repository as owner/name or a GitHub URL." });
        if (!/^(https?:\/\/)?(www\.)?(github\.com\/)?[\w.-]+\/[\w.-]+/i.test(repo)) return e.preventDefault(), setClientError({ field: "input", msg: "Use the form owner/name, for example panva/jose." });
        if (Boolean(eco) !== Boolean(pkg)) return e.preventDefault(), setClientError({ field: "packageName", msg: "Choose an ecosystem and enter the package name, or leave both empty." });
        setClientError(null);
      }}
    >
      <h2 id="add-candidate" className="font-semibold">
        Add a candidate
      </h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="cand-input" className="label">
            GitHub repository
          </label>
          <input id="cand-input" name="input" className="input font-mono text-sm" placeholder="owner/name or https://github.com/owner/name" autoComplete="off" spellCheck={false} aria-invalid={err?.field === "input" ? "true" : undefined} aria-describedby="cand-input-err" />
          <p id="cand-input-err" className="field-error" role="alert">
            {err?.field === "input" ? err.msg : ""}
          </p>
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-2">
          <div>
            <label htmlFor="cand-eco" className="label">
              Registry
            </label>
            <select id="cand-eco" name="ecosystem" className="input" defaultValue="">
              <option value="">None</option>
              <option value="npm">npm</option>
              <option value="pypi">PyPI</option>
            </select>
          </div>
          <div>
            <label htmlFor="cand-pkg" className="label">
              Package name
            </label>
            <input id="cand-pkg" name="packageName" className="input font-mono text-sm" placeholder="jose" autoComplete="off" spellCheck={false} aria-invalid={err?.field === "packageName" ? "true" : undefined} aria-describedby="cand-pkg-err" />
            <p id="cand-pkg-err" className="field-error" role="alert">
              {err?.field === "packageName" ? err.msg : ""}
            </p>
          </div>
        </div>
        <div>
          <label htmlFor="cand-use" className="label">
            Intended use (optional)
          </label>
          <input id="cand-use" name="intendedUse" className="input" maxLength={300} placeholder="JWT verification for the Node API" />
        </div>
        <div>
          <label htmlFor="cand-backing" className="label">
            Backing
          </label>
          <select id="cand-backing" name="sponsorship" className="input" defaultValue="unknown">
            {Object.entries(BACKING_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Checking GitHub and running the first health check…" : "Add candidate"}
        </button>
        <p className="text-xs text-ink-3">The repository and package are verified before saving, then health is checked right away.</p>
      </div>
    </form>
  );
}

function EditDialog({ c, onClose }: { c: AdminCandidate; onClose: () => void }) {
  const toast = useToast();
  const { ref: dialogRef, onCancel } = useDialog(onClose);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ intendedUse: c.intendedUse, ecosystem: c.packageEcosystem ?? "", packageName: c.packageName ?? "", sponsorship: c.sponsorship, teamNotes: c.teamNotes, notesPublic: c.notesPublic });
  return (
    <dialog ref={dialogRef} onCancel={onCancel} aria-labelledby="edit-title" className="m-auto">
      <form
        className="p-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (Boolean(form.ecosystem) !== Boolean(form.packageName.trim())) return setError("Choose an ecosystem and enter the package name, or leave both empty.");
          start(async () => {
            const r = await updateCandidateAction({ id: c.id, intendedUse: form.intendedUse, ecosystem: (form.ecosystem || null) as "npm" | "pypi" | null, packageName: form.packageName.trim() || null, sponsorship: form.sponsorship, teamNotes: form.teamNotes, notesPublic: form.notesPublic });
            if (r.ok) {
              toast.push("success", r.message);
              onClose();
            } else setError(r.error);
          });
        }}
      >
        <h2 id="edit-title" className="text-lg font-semibold">
          Edit {c.fullName}
        </h2>
        <div>
          <label htmlFor="e-use" className="label">
            Intended use
          </label>
          <input id="e-use" className="input" maxLength={300} value={form.intendedUse} onChange={(e) => setForm({ ...form, intendedUse: e.target.value })} />
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-2">
          <div>
            <label htmlFor="e-eco" className="label">
              Registry
            </label>
            <select id="e-eco" className="input" value={form.ecosystem} onChange={(e) => setForm({ ...form, ecosystem: e.target.value as "" | "npm" | "pypi" })}>
              <option value="">None</option>
              <option value="npm">npm</option>
              <option value="pypi">PyPI</option>
            </select>
          </div>
          <div>
            <label htmlFor="e-pkg" className="label">
              Package name
            </label>
            <input id="e-pkg" className="input font-mono text-sm" value={form.packageName} onChange={(e) => setForm({ ...form, packageName: e.target.value })} />
          </div>
        </div>
        <div>
          <label htmlFor="e-back" className="label">
            Backing (entered by the team)
          </label>
          <select id="e-back" className="input" value={form.sponsorship} onChange={(e) => setForm({ ...form, sponsorship: e.target.value as AdminCandidate["sponsorship"] })}>
            {Object.entries(BACKING_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="e-notes" className="label">
            Team notes
          </label>
          <textarea id="e-notes" className="input !min-h-24 !font-sans" maxLength={2000} value={form.teamNotes} onChange={(e) => setForm({ ...form, teamNotes: e.target.value })} />
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={form.notesPublic} onChange={(e) => setForm({ ...form, notesPublic: e.target.checked })} />
          Show team notes, backing and decision reasons on the public report
        </label>
        <p className="field-error" role="alert">
          {error ?? ""}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function DecisionDialog({ c, onClose }: { c: AdminCandidate; onClose: () => void }) {
  const toast = useToast();
  const { ref: dialogRef, onCancel } = useDialog(onClose);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<AdminCandidate["adoptionStatus"]>(c.adoptionStatus);
  const [reason, setReason] = useState("");
  const [by, setBy] = useState(() => {
    try {
      return localStorage.getItem("dp-decided-by") ?? "";
    } catch {
      return "";
    }
  });
  const [error, setError] = useState<{ field: string; msg: string } | null>(null);
  return (
    <dialog ref={dialogRef} onCancel={onCancel} aria-labelledby="decide-title" className="m-auto">
      <form
        className="p-5 space-y-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length < 5) return setError({ field: "reason", msg: "Give a reason of at least a few words." });
          if (by.trim().length < 2) return setError({ field: "by", msg: "Enter who made the decision." });
          setError(null);
          try {
            localStorage.setItem("dp-decided-by", by.trim());
          } catch {
            /* storage unavailable */
          }
          start(async () => {
            const r = await recordDecisionAction({ id: c.id, status, reason, decidedBy: by });
            if (r.ok) {
              toast.push("success", r.message);
              onClose();
            } else setError({ field: "reason", msg: r.error });
          });
        }}
      >
        <h2 id="decide-title" className="text-lg font-semibold">
          Record a decision for {c.fullName}
        </h2>
        <fieldset>
          <legend className="label">Status</legend>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(ADOPTION_STATUS_LABEL) as AdminCandidate["adoptionStatus"][]).map((s) => (
              <label key={s} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${status === s ? "border-accent bg-surface-2 font-semibold" : "border-line-strong"}`}>
                <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} className="accent-[var(--accent)]" />
                {ADOPTION_STATUS_LABEL[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="d-reason" className="label">
            Reason (required)
          </label>
          <textarea id="d-reason" className="input !min-h-24 !font-sans" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={error?.field === "reason" ? "true" : undefined} aria-describedby="d-reason-err" />
          <p id="d-reason-err" className="field-error" role="alert">
            {error?.field === "reason" ? error.msg : ""}
          </p>
        </div>
        <div>
          <label htmlFor="d-by" className="label">
            Decided by
          </label>
          <input id="d-by" className="input" maxLength={80} value={by} onChange={(e) => setBy(e.target.value)} autoComplete="name" aria-invalid={error?.field === "by" ? "true" : undefined} aria-describedby="d-by-err" />
          <p id="d-by-err" className="field-error" role="alert">
            {error?.field === "by" ? error.msg : ""}
          </p>
        </div>
        <p className="text-xs text-ink-3">Decisions are kept as history; the newest is shown first. Reasons stay private unless the candidate&apos;s notes are public.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Recording…" : "Record decision"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function MoveDialog({ c, onClose }: { c: AdminCandidate; onClose: () => void }) {
  const toast = useToast();
  const { ref: dialogRef, onCancel } = useDialog(onClose);
  const [pending, start] = useTransition();
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<"critical" | "normal" | "low">("normal");
  return (
    <dialog ref={dialogRef} onCancel={onCancel} aria-labelledby="move-title" className="m-auto">
      <form
        className="p-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await moveToDependenciesAction(c.id, category, priority);
            if (r.ok) {
              toast.push("success", r.message);
              onClose();
            } else toast.push("error", r.error);
          });
        }}
      >
        <h2 id="move-title" className="text-lg font-semibold">
          Move {c.fullName} to dependencies?
        </h2>
        <p className="text-sm text-ink-2">It starts appearing in the Monday release digest and leaves the evaluation watchlist. Its health history and decisions are kept. You can move it back from the Repositories page.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="m-cat" className="label">
              Digest category
            </label>
            <input id="m-cat" className="input" maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="auth" />
          </div>
          <div>
            <label htmlFor="m-prio" className="label">
              Priority
            </label>
            <select id="m-prio" className="input" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option value="critical">Critical</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Moving…" : "Move to dependencies"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function BulkCandidatesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<CandidateLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
  const looksValid = lines.filter((l) => /^(https?:\/\/)?(www\.)?(github\.com\/)?[\w.-]+\/[\w.-]+/i.test(l.split(/\s+/)[0])).length;
  const ready = checked?.filter((c) => c.status === "valid") ?? [];
  const STATUS: Record<CandidateLine["status"], { l: string; c: string }> = { valid: { l: "Ready", c: "text-ok" }, invalid: { l: "Invalid", c: "text-act" }, duplicate: { l: "Skipped", c: "text-ink-3" }, not_found: { l: "Not found", c: "text-act" } };
  return (
    <dialog ref={ref} onCancel={(e) => (e.preventDefault(), onClose())} aria-labelledby="bulk-c-title" className="m-auto">
      <div className="p-5 max-h-[calc(100vh-48px)] overflow-y-auto">
        <h2 id="bulk-c-title" className="text-lg font-semibold">
          Bulk import candidates
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          One per line: <code className="font-mono">owner/name npm:package | intended use</code>. The package and intended use are optional.
        </p>
        <label htmlFor="bulk-c" className="label mt-4">
          Candidates
        </label>
        <textarea
          id="bulk-c"
          className="input"
          value={text}
          spellCheck={false}
          placeholder={"panva/jose npm:jose | JWT verification for the Node API\nauth0/node-jsonwebtoken npm:jsonwebtoken"}
          onChange={(e) => {
            setText(e.target.value);
            setChecked(null);
          }}
          aria-describedby="bulk-c-live"
        />
        <p id="bulk-c-live" className="mt-1 text-xs text-ink-3" aria-live="polite">
          {lines.length === 0 ? "Nothing pasted yet." : `${looksValid} of ${lines.length} lines look valid.`}
        </p>
        {checked && (
          <ul className="mt-3 card divide-y divide-line max-h-64 overflow-y-auto text-sm" data-testid="bulk-c-preview">
            {checked.map((l) => (
              <li key={l.line} className="flex items-start gap-3 px-3 py-2">
                <span className="w-6 shrink-0 text-ink-3 tabular">{l.line}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono break-all">{l.fullName ?? l.input}</span>
                  <span className="block text-xs text-ink-3">{l.message}</span>
                </span>
                <span className={`shrink-0 text-xs font-semibold ${STATUS[l.status].c}`}>
                  {l.status === "valid" ? <IconCheck size={12} className="inline" /> : <IconX size={12} className="inline" />} {STATUS[l.status].l}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="field-error mt-2" role="alert">
          {error ?? ""}
        </p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {!checked ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || looksValid === 0}
              onClick={() =>
                start(async () => {
                  const r = await validateCandidatesBulkAction(text);
                  if (r.ok) setChecked(r.data ?? []);
                  else setError(r.error);
                })
              }
            >
              {pending ? "Checking GitHub…" : `Check ${looksValid} on GitHub`}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || ready.length === 0}
              onClick={() =>
                start(async () => {
                  const r = await importCandidatesBulkAction(ready.map((x) => ({ fullName: x.fullName!, ecosystem: x.ecosystem ?? null, packageName: x.packageName ?? null, intendedUse: x.intendedUse ?? "" })));
                  if (r.ok) {
                    toast.push("success", r.message);
                    setText("");
                    setChecked(null);
                    onClose();
                  } else setError(r.error);
                })
              }
            >
              {pending ? "Importing…" : `Import ${ready.length}`}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
