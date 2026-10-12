import { IconCheck, IconPause, IconSlash, IconX } from "@/components/icons";

const MAP = {
  ok: { label: "OK", cls: "chip-ok", icon: <IconCheck size={12} /> },
  not_found: { label: "Not found", cls: "chip-act", icon: <IconSlash size={12} /> },
  rate_limited: { label: "Rate limited", cls: "chip-review", icon: <IconPause size={12} /> },
  error: { label: "Error", cls: "chip-act", icon: <IconX size={12} /> },
} as const;

export function StatusBadge({ status }: { status: keyof typeof MAP | null }) {
  if (!status) return <span className="chip">Not checked yet</span>;
  const s = MAP[status];
  return (
    <span className={`chip ${s.cls}`}>
      {s.icon} {s.label}
    </span>
  );
}

const RUN_MAP: Record<string, { label: string; cls: string }> = {
  running: { label: "Running", cls: "" },
  ok: { label: "OK", cls: "chip-ok" },
  partial: { label: "Partial", cls: "chip-review" },
  failed: { label: "Failed", cls: "chip-act" },
  skipped: { label: "Skipped", cls: "" },
};

export function RunStatusBadge({ status }: { status: string }) {
  const s = RUN_MAP[status] ?? { label: status, cls: "" };
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}
