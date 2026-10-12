"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addRepoAction, deleteRepoAction, updateRepoAction, type ActionResult } from "@/app/admin/actions";
import { BulkImportDialog } from "@/components/admin/bulk-import";
import { StatusBadge } from "@/components/admin/status-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";

export interface RepoView {
  id: number;
  fullName: string;
  category: string;
  priority: "critical" | "normal" | "low";
  notes: string;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastStatus: "ok" | "not_found" | "rate_limited" | "error" | null;
  lastError: string | null;
}

type SortKey = "name" | "priority" | "status" | "checked";
const PRIORITY_RANK = { critical: 0, normal: 1, low: 2 } as const;
const STATUS_RANK = { not_found: 0, error: 1, rate_limited: 2, ok: 3 } as const;

function fmtChecked(iso: string | null): string {
  if (!iso) return "Never";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`chip !min-h-9 !px-3 cursor-pointer ${active ? "!border-accent !text-ink !bg-surface-2 font-semibold" : ""}`} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

export function RepoManager({ initial }: { initial: RepoView[] }) {
  const toast = useToast();
  const [repos, setRepos] = useState(initial);
  // Adopt fresh server data after revalidation (adjusting state during render, not in an effect).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setRepos(initial);
  }
  const [query, setQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("name");
  const [toDelete, setToDelete] = useState<RepoView | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const categories = useMemo(() => [...new Set(repos.map((r) => r.category).filter(Boolean))].sort(), [repos]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repos
      .filter((r) => !q || r.fullName.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q) || r.category.includes(q))
      .filter((r) => enabledFilter === "all" || (enabledFilter === "enabled" ? r.enabled : !r.enabled))
      .filter((r) => !priorityFilter || r.priority === priorityFilter)
      .filter((r) => !categoryFilter || r.category === categoryFilter)
      .filter((r) => !statusFilter || (statusFilter === "unchecked" ? r.lastStatus === null : r.lastStatus === statusFilter))
      .sort((a, b) => {
        if (sort === "priority") return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.fullName.localeCompare(b.fullName);
        if (sort === "status") return (a.lastStatus ? STATUS_RANK[a.lastStatus] : 4) - (b.lastStatus ? STATUS_RANK[b.lastStatus] : 4) || a.fullName.localeCompare(b.fullName);
        if (sort === "checked") return (b.lastCheckedAt ?? "").localeCompare(a.lastCheckedAt ?? "");
        return a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase());
      });
  }, [repos, query, enabledFilter, priorityFilter, categoryFilter, statusFilter, sort]);

  /** Optimistic update with rollback on error. */
  function patch(id: number, change: Partial<RepoView>) {
    const before = repos.find((r) => r.id === id);
    if (!before) return;
    setRepos((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)));
    startTransition(async () => {
      const res = await updateRepoAction({ id, ...change });
      if (res.ok) toast.push("success", res.message);
      else {
        setRepos((rs) => rs.map((r) => (r.id === id ? before : r)));
        toast.push("error", res.error);
      }
    });
  }

  function confirmDelete() {
    const target = toDelete;
    if (!target) return;
    startTransition(async () => {
      const res = await deleteRepoAction(target.id);
      if (res.ok) {
        setRepos((rs) => rs.filter((r) => r.id !== target.id));
        toast.push("success", `${target.fullName} removed.`);
      } else toast.push("error", res.error);
      setToDelete(null);
    });
  }

  const enabledCount = repos.filter((r) => r.enabled).length;
  const problemCount = repos.filter((r) => r.lastStatus && r.lastStatus !== "ok").length;
  const anyFilter = query || enabledFilter !== "all" || priorityFilter || categoryFilter || statusFilter;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tracked repositories</h1>
          <p className="mt-1 text-sm text-ink-2 tabular">
            {repos.length} tracked · {enabledCount} enabled{problemCount ? ` · ${problemCount} with problems in the last run` : ""}. Changes apply to the next run, no redeploy needed.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setBulkOpen(true)}>
          Bulk import
        </button>
      </div>

      <AddRepoForm categories={categories} />

      <div className="mt-8 space-y-3" role="search" aria-label="Filter repositories">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="repo-search" className="label">
              Search
            </label>
            <input id="repo-search" type="search" className="input" placeholder="Name, category or note" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div>
            <label htmlFor="repo-sort" className="label">
              Sort by
            </label>
            <select id="repo-sort" className="input !w-auto pr-8" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="name">Name</option>
              <option value="priority">Priority</option>
              <option value="status">Last status (problems first)</option>
              <option value="checked">Last checked</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-3 mr-1">Show</span>
          <FilterChip active={enabledFilter === "enabled"} onClick={() => setEnabledFilter(enabledFilter === "enabled" ? "all" : "enabled")}>
            Enabled
          </FilterChip>
          <FilterChip active={enabledFilter === "disabled"} onClick={() => setEnabledFilter(enabledFilter === "disabled" ? "all" : "disabled")}>
            Disabled
          </FilterChip>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          {(["critical", "normal", "low"] as const).map((p) => (
            <FilterChip key={p} active={priorityFilter === p} onClick={() => setPriorityFilter(priorityFilter === p ? null : p)}>
              {p}
            </FilterChip>
          ))}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          {categories.map((c) => (
            <FilterChip key={c} active={categoryFilter === c} onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}>
              {c}
            </FilterChip>
          ))}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          {[
            ["ok", "OK"],
            ["not_found", "Not found"],
            ["rate_limited", "Rate limited"],
            ["error", "Error"],
            ["unchecked", "Not checked yet"],
          ].map(([v, l]) => (
            <FilterChip key={v} active={statusFilter === v} onClick={() => setStatusFilter(statusFilter === v ? null : v)}>
              {l}
            </FilterChip>
          ))}
          {anyFilter && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setQuery("");
                setEnabledFilter("all");
                setPriorityFilter(null);
                setCategoryFilter(null);
                setStatusFilter(null);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {visible.length} of {repos.length} repositories shown.
      </p>

      {repos.length === 0 ? (
        <div className="card mt-6 p-6">
          <h2 className="font-semibold">No repositories tracked yet</h2>
          <p className="mt-1 text-ink-2">Add one above, paste a list with Bulk import, or run the seed script (pnpm db:seed).</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="card mt-6 p-6">
          <h2 className="font-semibold">No repositories match these filters</h2>
          <p className="mt-1 text-ink-2">Clear a filter or change the search to see more.</p>
        </div>
      ) : (
        <div className="mt-4 md:card md:overflow-x-auto">
          <table className="data-table" aria-busy={pending}>
            <caption className="sr-only">Tracked repositories</caption>
            <thead>
              <tr>
                <th scope="col">Repository</th>
                <th scope="col">Category</th>
                <th scope="col">Priority</th>
                <th scope="col">Enabled</th>
                <th scope="col">Last checked</th>
                <th scope="col">Last status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <RepoRow key={r.id} r={r} onPatch={patch} onDelete={() => setToDelete(r)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={`Remove ${toDelete?.fullName ?? ""}?`}
        body={<p>It stops appearing in digests. Past digests and release history are kept, and adding it again restores it.</p>}
        confirmLabel="Remove repository"
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
        pending={pending}
      />
      <BulkImportDialog open={bulkOpen} onClose={() => setBulkOpen(false)} categories={categories} />
    </div>
  );
}

function RepoRow({ r, onPatch, onDelete }: { r: RepoView; onPatch: (id: number, c: Partial<RepoView>) => void; onDelete: () => void }) {
  const [category, setCategory] = useState(r.category);
  const [notes, setNotes] = useState(r.notes);
  const [editingNotes, setEditingNotes] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);
  const [prevR, setPrevR] = useState(r);
  if (r !== prevR) {
    setPrevR(r);
    setCategory(r.category);
    setNotes(r.notes);
  }
  const base = `repo-${r.id}`;

  function saveCategory() {
    const v = category.trim().toLowerCase();
    if (v === r.category) return;
    if (!/^[a-z0-9 _-]{0,40}$/.test(v)) {
      setCatError("Use up to 40 letters, numbers, spaces, dashes or underscores.");
      return;
    }
    setCatError(null);
    onPatch(r.id, { category: v });
  }

  return (
    <tr className={r.enabled ? "" : "opacity-70"} data-testid="repo-row" data-repo={r.fullName}>
      <td data-label="Repository" className="!block md:!table-cell">
        <div className="min-w-0">
          <a href={`https://github.com/${r.fullName}/releases`} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink no-underline hover:underline break-all">
            {r.fullName}
          </a>
          {editingNotes ? (
            <div className="mt-1 flex gap-2">
              <label htmlFor={`${base}-notes`} className="sr-only">
                Notes for {r.fullName}
              </label>
              <input
                id={`${base}-notes`}
                className="input !min-h-9 text-sm"
                value={notes}
                maxLength={500}
                autoFocus
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setEditingNotes(false);
                    if (notes.trim() !== r.notes) onPatch(r.id, { notes: notes.trim() });
                  }
                  if (e.key === "Escape") {
                    setNotes(r.notes);
                    setEditingNotes(false);
                  }
                }}
                onBlur={() => {
                  setEditingNotes(false);
                  if (notes.trim() !== r.notes) onPatch(r.id, { notes: notes.trim() });
                }}
              />
            </div>
          ) : (
            <button type="button" className="mt-0.5 block text-left text-sm text-ink-3 hover:text-ink-2 min-h-8" onClick={() => setEditingNotes(true)} aria-label={`Edit notes for ${r.fullName}`}>
              {r.notes || <span className="italic">Add a note</span>}
            </button>
          )}
        </div>
      </td>
      <td data-label="Category">
        <div>
          <label htmlFor={`${base}-cat`} className="sr-only">
            Category for {r.fullName}
          </label>
          <input
            id={`${base}-cat`}
            className="input !min-h-9 !w-36 text-sm"
            value={category}
            list="category-options"
            onChange={(e) => setCategory(e.target.value)}
            onBlur={saveCategory}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            aria-invalid={catError ? "true" : undefined}
            aria-describedby={catError ? `${base}-cat-err` : undefined}
          />
          {catError && (
            <p id={`${base}-cat-err`} className="field-error">
              {catError}
            </p>
          )}
        </div>
      </td>
      <td data-label="Priority">
        <label htmlFor={`${base}-prio`} className="sr-only">
          Priority for {r.fullName}
        </label>
        <select id={`${base}-prio`} className="input !min-h-9 !w-28 text-sm" value={r.priority} onChange={(e) => onPatch(r.id, { priority: e.target.value as RepoView["priority"] })}>
          <option value="critical">Critical</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </td>
      <td data-label="Enabled">
        <button type="button" role="switch" aria-checked={r.enabled} className="switch" onClick={() => onPatch(r.id, { enabled: !r.enabled })} aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.fullName}`} data-testid="enable-toggle">
          <span className="switch-track" />
        </button>
      </td>
      <td data-label="Last checked" className="text-sm text-ink-2 tabular whitespace-nowrap">
        {fmtChecked(r.lastCheckedAt)}
      </td>
      <td data-label="Last status" className="text-sm">
        <div>
          <StatusBadge status={r.lastStatus} />
          {r.lastError && r.lastStatus !== "ok" && <p className="mt-1 max-w-[16rem] text-xs text-ink-3 break-words">{r.lastError}</p>}
        </div>
      </td>
      <td className="text-right">
        <button type="button" className="btn btn-ghost btn-sm text-act" onClick={onDelete} aria-label={`Remove ${r.fullName}`}>
          Remove
        </button>
      </td>
    </tr>
  );
}

function AddRepoForm({ categories }: { categories: string[] }) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addRepoAction, null);
  const [clientError, setClientError] = useState<string | null>(null);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.push("success", state.message);
      formRef.current?.reset();
    }
  }, [state, toast]);
  const serverError = state && !state.ok ? state.error : null;
  const error = clientError ?? serverError;
  return (
    <form
      ref={formRef}
      action={action}
      className="card mt-6 p-4 sm:p-5"
      aria-labelledby="add-repo-title"
      onSubmit={(e) => {
        const v = String(new FormData(e.currentTarget).get("input") ?? "").trim();
        if (!v) {
          e.preventDefault();
          setClientError("Enter a repository as owner/name or a GitHub URL.");
        } else if (!/^(https?:\/\/)?(www\.)?(github\.com\/)?[\w.-]+\/[\w.-]+/i.test(v) && !/^git@github\.com:/.test(v)) {
          e.preventDefault();
          setClientError("Use the form owner/name, for example stripe/stripe-node.");
        } else setClientError(null);
      }}
    >
      <h2 id="add-repo-title" className="font-semibold">
        Add a repository
      </h2>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start">
        <div>
          <label htmlFor="add-input" className="label">
            Repository
          </label>
          <input
            id="add-input"
            name="input"
            className="input font-mono text-sm"
            placeholder="owner/name or https://github.com/owner/name"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? "true" : undefined}
            aria-describedby="add-input-help add-input-error"
            onChange={() => clientError && setClientError(null)}
          />
          <p id="add-input-help" className="mt-1 text-xs text-ink-3">
            Checked on GitHub before saving.
          </p>
          <p id="add-input-error" className="field-error" role="alert">
            {error ?? ""}
          </p>
        </div>
        <div>
          <label htmlFor="add-category" className="label">
            Category
          </label>
          <input id="add-category" name="category" className="input" list="category-options" placeholder="payments" />
          <datalist id="category-options">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="add-priority" className="label">
            Priority
          </label>
          <select id="add-priority" name="priority" className="input" defaultValue="normal">
            <option value="critical">Critical</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="md:pt-[30px]">
          <button type="submit" className="btn btn-primary w-full md:w-auto" disabled={pending}>
            {pending ? "Checking GitHub…" : "Add repository"}
          </button>
        </div>
      </div>
    </form>
  );
}
