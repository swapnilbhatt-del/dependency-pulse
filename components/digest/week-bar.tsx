import type { DigestModel } from "@/lib/digest/model";

/** Stacked proportion bar: act / review / FYI share of a week's releases. */
export function WeekBar({ counts, className = "" }: { counts: DigestModel["counts"]; className?: string }) {
  const total = counts.act + counts.review + counts.fyi;
  if (total === 0) return <span className={`bar-track ${className}`} aria-hidden="true" />;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <span className={`bar-track ${className}`} aria-hidden="true">
      <span style={{ width: pct(counts.act), background: "var(--act)" }} />
      <span style={{ width: pct(counts.review), background: "var(--review)" }} />
      <span style={{ width: pct(counts.fyi), background: "var(--line-strong)" }} />
    </span>
  );
}
