"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { importBulkAction, validateBulkAction, type BulkLineResult } from "@/app/admin/actions";
import { IconCheck, IconSlash, IconX } from "@/components/icons";
import { useToast } from "@/components/toast";
import { parseBulkInput } from "@/lib/repos/normalize";

const STATUS_UI: Record<BulkLineResult["status"], { label: string; cls: string; icon: React.ReactNode }> = {
  valid: { label: "Ready", cls: "text-ok", icon: <IconCheck size={13} /> },
  invalid: { label: "Invalid", cls: "text-act", icon: <IconX size={13} /> },
  duplicate: { label: "Skipped", cls: "text-ink-3", icon: <IconSlash size={13} /> },
  not_found: { label: "Not found", cls: "text-act", icon: <IconX size={13} /> },
};

/**
 * Paste one repository per line. Format is validated instantly in the browser
 * (same parser as the server); "Check on GitHub" then confirms each line exists
 * before anything is saved.
 */
export function BulkImportDialog({ open, onClose, categories }: { open: boolean; onClose: () => void; categories: string[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<"critical" | "normal" | "low">("normal");
  const [checked, setChecked] = useState<BulkLineResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const local = parseBulkInput(text);
  const localValid = local.filter((l) => l.result.ok).length;
  const ready = checked?.filter((c) => c.status === "valid") ?? [];

  function check() {
    setError(null);
    start(async () => {
      const res = await validateBulkAction(text);
      if (res.ok) setChecked(res.data ?? []);
      else setError(res.error);
    });
  }

  function commit() {
    start(async () => {
      const res = await importBulkAction(
        ready.map((r) => r.fullName!),
        { category: category.trim().toLowerCase() || undefined, priority },
      );
      if (res.ok) {
        toast.push("success", res.message);
        setText("");
        setChecked(null);
        onClose();
      } else setError(res.error);
    });
  }

  return (
    <dialog ref={ref} onCancel={(e) => (e.preventDefault(), onClose())} aria-labelledby="bulk-title" className="m-auto">
      <div className="p-5 max-h-[calc(100vh-48px)] overflow-y-auto">
        <h2 id="bulk-title" className="text-lg font-semibold">
          Bulk import repositories
        </h2>
        <p className="mt-1 text-sm text-ink-2">One per line: owner/name or a GitHub URL. Lines starting with # are ignored.</p>
        <label htmlFor="bulk-text" className="label mt-4">
          Repositories
        </label>
        <textarea
          id="bulk-text"
          className="input"
          value={text}
          spellCheck={false}
          placeholder={"stripe/stripe-node\nhttps://github.com/panva/jose\n# comments are ignored"}
          onChange={(e) => {
            setText(e.target.value);
            setChecked(null);
          }}
          aria-describedby="bulk-live"
        />
        <p id="bulk-live" className="mt-1 text-xs text-ink-3" aria-live="polite">
          {local.length === 0 ? "Nothing pasted yet." : `${localValid} of ${local.length} lines look valid.`}
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="bulk-cat" className="label">
              Category for all (optional)
            </label>
            <input id="bulk-cat" className="input" list="bulk-cats" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="bulk-cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="bulk-prio" className="label">
              Priority for all
            </label>
            <select id="bulk-prio" className="input" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option value="critical">Critical</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        {local.length > 0 && (
          <div className="mt-4">
            <h3 className="eyebrow">{checked ? "GitHub check" : "Format check"}</h3>
            <ul className="mt-2 card divide-y divide-line max-h-64 overflow-y-auto text-sm" data-testid="bulk-preview">
              {(checked ?? local.map((l) => ({ line: l.line, input: l.input, status: l.result.ok ? ("valid" as const) : ("invalid" as const), message: l.result.ok ? "Format OK; not yet checked on GitHub." : l.result.error, fullName: l.result.ok ? l.result.fullName : undefined }))).map((l) => {
                const ui = STATUS_UI[l.status];
                return (
                  <li key={l.line} className="flex items-start gap-3 px-3 py-2">
                    <span className="w-8 shrink-0 text-ink-3 tabular">{l.line}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono break-all">{l.fullName ?? l.input}</span>
                      <span className="block text-xs text-ink-3">{l.message}</span>
                    </span>
                    <span className={`flex shrink-0 items-center gap-1 text-xs font-semibold ${checked || l.status !== "valid" ? ui.cls : "text-ink-3"}`}>
                      {ui.icon}
                      {checked || l.status !== "valid" ? ui.label : "Format OK"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="field-error mt-2" role="alert">
          {error ?? ""}
        </p>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {!checked ? (
            <button type="button" className="btn btn-primary" onClick={check} disabled={pending || localValid === 0}>
              {pending ? "Checking GitHub…" : `Check ${localValid} on GitHub`}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={commit} disabled={pending || ready.length === 0}>
              {pending ? "Importing…" : `Import ${ready.length} ${ready.length === 1 ? "repository" : "repositories"}`}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
