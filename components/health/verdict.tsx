import { IconAlert, IconCheck, IconDot, IconDown, IconQuestion, IconReview, IconUp } from "@/components/icons";
import type { ReasonTag, Verdict } from "@/lib/health/types";
import { VERDICT_LABEL } from "@/lib/health/types";

const STYLE: Record<Verdict, { cls: string; icon: React.ReactNode }> = {
  healthy: { cls: "chip-ok", icon: <IconCheck size={12} /> },
  watch: { cls: "chip-review", icon: <IconReview size={12} /> },
  risky: { cls: "chip-act", icon: <IconAlert size={12} /> },
  insufficient: { cls: "chip-dashed", icon: <IconQuestion size={12} /> },
};

/** Verdict chip: icon + text label, so colour is never the only signal. */
export function VerdictChip({ verdict, large = false }: { verdict: Verdict | null; large?: boolean }) {
  if (!verdict) return <span className="chip chip-dashed">Not checked yet</span>;
  const s = STYLE[verdict];
  return (
    <span className={`chip ${s.cls} ${large ? "!min-h-9 !px-3.5 !text-sm font-semibold" : ""}`} data-verdict={verdict}>
      {s.icon} {VERDICT_LABEL[verdict]}
    </span>
  );
}

export function ScoreMeter({ score, coverage, compact = false }: { score: number | null; coverage: number | null; compact?: boolean }) {
  const color = score === null ? "var(--line-strong)" : score >= 75 ? "var(--ok)" : score >= 50 ? "var(--review)" : "var(--act)";
  return (
    <div className={compact ? "" : "min-w-[8rem]"}>
      <p className="tabular">
        <span className={`font-display ${compact ? "text-2xl" : "text-4xl"}`}>{score ?? "—"}</span>
        <span className="text-sm text-ink-3"> / 100</span>
      </p>
      <span className="bar-track mt-1.5 block" aria-hidden="true">
        <span style={{ width: `${score ?? 0}%`, background: color }} />
      </span>
      {coverage !== null && (
        <p className="mt-1 text-xs text-ink-3 tabular">
          {Math.round(coverage * 100)}% of weight had data{coverage < 1 ? " (partial)" : ""}
        </p>
      )}
    </div>
  );
}

const TAG: Record<ReasonTag, { label: string; cls: string; icon: React.ReactNode }> = {
  positive: { label: "Positive", cls: "text-ok", icon: <IconUp /> },
  neutral: { label: "Neutral", cls: "text-ink-3", icon: <IconDot /> },
  concern: { label: "Concern", cls: "text-act", icon: <IconDown /> },
};

export function ReasonTagBadge({ tag }: { tag: ReasonTag }) {
  const t = TAG[tag];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-wide ${t.cls} w-[5.5rem]`}>
      {t.icon} {t.label}
    </span>
  );
}

/** "3 concerns · 4 neutral · 9 positive" — the balance at a glance. */
export function ReasonBalance({ reasons }: { reasons: { tag: ReasonTag }[] }) {
  const n = (t: ReasonTag) => reasons.filter((r) => r.tag === t).length;
  return (
    <p className="flex flex-wrap gap-x-3 text-xs font-semibold tabular">
      <span className="text-act">{n("concern")} concerns</span>
      <span className="text-ink-3">{n("neutral")} neutral</span>
      <span className="text-ok">{n("positive")} positive</span>
    </p>
  );
}
