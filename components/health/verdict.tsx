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
        <span className={`font-display ${compact ? "text-2xl" : "text-4xl"}`} data-count>{score ?? "—"}</span>
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

const RING_COLOR = { light: { ok: "var(--ok)", review: "var(--review)", act: "var(--act)" }, dark: { ok: "var(--mast-ok)", review: "var(--mast-review)", act: "var(--mast-act)" } } as const;

const VERDICT_BAND: Record<Verdict, "ok" | "review" | "act" | null> = { healthy: "ok", watch: "review", risky: "act", insufficient: null };

/**
 * Circular score: the arc length is the score. It is coloured by the verdict when one is given
 * (a gate can cap an 81 to Watch, so the ring must not look Healthy), otherwise by score band.
 */
export function ScoreRing({ score, verdict, size = 64, stroke = 6, tone = "light", showMax = false }: { score: number | null; verdict?: Verdict | null; size?: number; stroke?: number; tone?: "light" | "dark"; showMax?: boolean }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const band = score === null ? null : verdict ? VERDICT_BAND[verdict] : score >= 75 ? "ok" : score >= 50 ? "review" : "act";
  const offset = (circ * (1 - pct)).toFixed(2);
  const mid = size / 2;
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="var(--ring-track)" strokeWidth={stroke} />
        {band && (
          <circle
            className="ring-arc"
            cx={mid}
            cy={mid}
            r={r}
            fill="none"
            stroke={RING_COLOR[tone][band]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ.toFixed(2)}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${mid} ${mid})`}
            style={{ ["--circ" as string]: circ.toFixed(2) }}
            data-ring={offset}
          />
        )}
      </svg>
      <span className="score-ring-num">
        <span className="font-display tabular" style={{ fontSize: Math.round(size * 0.36) }} data-count>
          {score ?? "—"}
        </span>
        {showMax ? <span className={`block text-xs ${tone === "dark" ? "text-mast-ink-2" : "text-ink-3"}`}>/ 100</span> : <span className="sr-only"> out of 100</span>}
      </span>
    </div>
  );
}
