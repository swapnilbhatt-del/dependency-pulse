"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addRecipientAction, removeRecipientAction, type ActionResult } from "@/app/admin/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";

export function RecipientsManager({ rows, envDefaults }: { rows: { id: number; email: string; addedAt: string }[]; envDefaults: string[] }) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addRecipientAction, null);
  const [toRemove, setToRemove] = useState<{ id: number; email: string } | null>(null);
  const [removing, start] = useTransition();
  const [clientError, setClientError] = useState<string | null>(null);
  useEffect(() => {
    if (state?.ok) {
      toast.push("success", state.message);
      formRef.current?.reset();
    }
  }, [state, toast]);
  const error = clientError ?? (state && !state.ok ? state.error : null);

  return (
    <div className="space-y-6">
      <form
        ref={formRef}
        action={action}
        className="card p-4 sm:p-5"
        noValidate
        onSubmit={(e) => {
          const v = String(new FormData(e.currentTarget).get("email") ?? "").trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
            e.preventDefault();
            setClientError("Enter a valid email address.");
          } else setClientError(null);
        }}
      >
        <label htmlFor="email" className="label">
          Add a recipient
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input id="email" name="email" type="email" className="input" autoComplete="email" placeholder="name@company.com" aria-invalid={error ? "true" : undefined} aria-describedby="email-error" onChange={() => clientError && setClientError(null)} />
          <button type="submit" className="btn btn-primary shrink-0" disabled={pending}>
            {pending ? "Adding…" : "Add recipient"}
          </button>
        </div>
        <p id="email-error" className="field-error" role="alert">
          {error ?? ""}
        </p>
      </form>

      {rows.length === 0 ? (
        <div className="card p-5">
          <h2 className="font-semibold">No recipients in the database</h2>
          {envDefaults.length > 0 ? (
            <p className="mt-1 text-ink-2">
              The digest goes to the default from DIGEST_RECIPIENTS: <span className="font-mono">{envDefaults.join(", ")}</span>. Add a recipient above to manage the list here instead.
            </p>
          ) : (
            <p className="mt-1 text-ink-2">Nobody will receive the Monday email. Add at least one address above.</p>
          )}
        </div>
      ) : (
        <ul className="card divide-y divide-line" aria-label="Recipients">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 p-3 sm:px-4">
              <span className="font-mono text-sm break-all">{r.email}</span>
              <button type="button" className="btn btn-ghost btn-sm text-act" onClick={() => setToRemove(r)} aria-label={`Remove ${r.email}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && envDefaults.length > 0 && <p className="text-sm text-ink-3">The DIGEST_RECIPIENTS default ({envDefaults.join(", ")}) is only used when this list is empty.</p>}

      <ConfirmDialog
        open={toRemove !== null}
        title="Remove this recipient?"
        body={<p>{toRemove?.email} will stop receiving the Monday digest.</p>}
        confirmLabel="Remove recipient"
        pending={removing}
        onCancel={() => setToRemove(null)}
        onConfirm={() =>
          start(async () => {
            const res = await removeRecipientAction(toRemove!.id);
            if (res.ok) toast.push("success", res.message);
            else toast.push("error", res.error);
            setToRemove(null);
          })
        }
      />
    </div>
  );
}
