"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { IconCheck, IconX } from "@/components/icons";

type Toast = { id: number; kind: "success" | "error"; text: string };
const Ctx = createContext<{ push: (kind: Toast["kind"], text: string) => void } | null>(null);

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used inside <ToastProvider>");
  return c;
}

/** Bottom-center toasts in a polite live region; errors stay until dismissed, successes leave after 5s. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Toast["kind"], text: string) => {
      const id = next.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, text }]);
      if (kind === "success") setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx value={value}>
      {children}
      <div aria-live="polite" role="status" className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-lg items-start gap-3 rounded-[10px] border px-4 py-3 text-sm shadow-lg bg-surface ${t.kind === "error" ? "border-act-line" : "border-line"}`}
            data-testid={`toast-${t.kind}`}
          >
            <span className={t.kind === "error" ? "text-act mt-0.5" : "text-ok mt-0.5"}>{t.kind === "error" ? <IconX /> : <IconCheck />}</span>
            <p className="flex-1 text-ink">{t.text}</p>
            <button type="button" onClick={() => dismiss(t.id)} className="btn btn-ghost btn-sm !min-h-8 !px-2 -my-1" aria-label="Dismiss notification">
              <IconX />
            </button>
          </div>
        ))}
      </div>
    </Ctx>
  );
}
