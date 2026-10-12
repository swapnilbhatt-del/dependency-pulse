import type { DigestModel } from "@/lib/digest/model";

/** The four counts inline, with text labels so color is never the only signal. */
export function CountRow({ counts }: { counts: DigestModel["counts"] }) {
  const items = [
    { n: counts.act, label: "act now", cls: counts.act ? "text-act font-semibold" : "text-ink-3" },
    { n: counts.review, label: "review", cls: counts.review ? "text-review font-semibold" : "text-ink-3" },
    { n: counts.fyi, label: "FYI", cls: "text-ink-2" },
    { n: counts.couldNotCheck, label: "could not check", cls: counts.couldNotCheck ? "text-ink-2" : "text-ink-3" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular" aria-label="Counts">
      {items.map((i) => (
        <li key={i.label} className={i.cls}>
          <span className="text-base">{i.n}</span> {i.label}
        </li>
      ))}
    </ul>
  );
}
