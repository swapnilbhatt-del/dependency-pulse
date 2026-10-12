"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resendWeekAction, runPreviewAction, sendNowAction } from "@/app/admin/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";

export function RunControls({ currentWeek, currentWeekSent }: { currentWeek: string; currentWeekSent: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<null | "preview" | "send" | "force">(null);
  const [confirmForce, setConfirmForce] = useState(false);
  const [, start] = useTransition();

  const run = (kind: "preview" | "send" | "force") => {
    setBusy(kind);
    start(async () => {
      if (kind === "preview") {
        const r = await runPreviewAction();
        if (r.ok && r.data) {
          toast.push("success", r.message);
          router.push(`/admin/preview/${r.data.runId}`);
        } else if (!r.ok) toast.push("error", r.error);
      } else {
        const r = await sendNowAction(kind === "force");
        if (r.ok) toast.push("success", r.message);
        else toast.push("error", r.error);
        router.refresh();
      }
      setBusy(null);
      setConfirmForce(false);
    });
  };

  return (
    <section aria-labelledby="run-controls" className="card p-4 sm:p-5">
      <h2 id="run-controls" className="font-semibold">
        Run the digest
      </h2>
      <p className="mt-1 text-sm text-ink-2 measure">
        The weekly job runs automatically on Mondays. A preview fetches live data and builds the digest without emailing anyone. Sending builds the digest for {currentWeek} and emails all recipients.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" aria-live="polite">
        <button type="button" className="btn btn-primary" onClick={() => run("preview")} disabled={busy !== null}>
          {busy === "preview" ? "Building preview… (up to a few minutes)" : "Run preview"}
        </button>
        {currentWeekSent ? (
          <button type="button" className="btn btn-danger" onClick={() => setConfirmForce(true)} disabled={busy !== null}>
            {busy === "force" ? "Regenerating and sending…" : "Regenerate and resend"}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => run("send")} disabled={busy !== null}>
            {busy === "send" ? "Building and sending…" : "Send digest now"}
          </button>
        )}
      </div>
      {currentWeekSent && <p className="mt-2 text-sm text-ink-3">The digest for {currentWeek} has already been sent, so the weekly job will not send it again.</p>}
      <ConfirmDialog
        open={confirmForce}
        title={`Regenerate and resend ${currentWeek}?`}
        body={<p>This fetches fresh data, replaces this week&apos;s published digest, and emails every recipient again.</p>}
        confirmLabel="Regenerate and resend"
        onConfirm={() => run("force")}
        onCancel={() => setConfirmForce(false)}
        pending={busy === "force"}
      />
    </section>
  );
}

export function ResendButton({ isoWeek }: { isoWeek: string }) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        Resend
      </button>
      <ConfirmDialog
        open={open}
        title={`Resend the ${isoWeek} digest?`}
        body={<p>The stored digest is emailed again to every current recipient. It is not regenerated.</p>}
        confirmLabel="Resend digest"
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          start(async () => {
            const r = await resendWeekAction(isoWeek);
            if (r.ok) toast.push("success", r.message);
            else toast.push("error", r.error);
            setOpen(false);
            router.refresh();
          })
        }
      />
    </>
  );
}
