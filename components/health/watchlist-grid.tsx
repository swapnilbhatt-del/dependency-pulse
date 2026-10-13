"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ReasonTagBadge, ScoreRing, VerdictChip } from "@/components/health/verdict";
import { IconArrowRight } from "@/components/icons";
import { ADOPTION_STATUS_LABEL } from "@/lib/health/labels";
import type { CandidateCard } from "@/lib/health/queries";
import { VERDICT_LABEL, type Verdict } from "@/lib/health/types";

const VERDICTS: Verdict[] = ["healthy", "watch", "risky", "insufficient"];
const STATUSES = ["evaluating", "adopted", "rejected", "parked"] as const;

function ago(iso: string | null): string {
  if (!iso) return "Not checked yet";
  return `Checked ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso))}`;
}

export function WatchlistGrid({ cards }: { cards: CandidateCard[] }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [status, setStatus] = useState<(typeof STATUSES)[number] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const shown = useMemo(() => cards.filter((c) => (!verdict || c.verdict === verdict) && (!status || c.adoptionStatus === status)), [cards, verdict, status]);
  const toggle = (slug: string) => setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : p.length >= 4 ? p : [...p, slug]));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by verdict">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Verdict</span>
        {VERDICTS.map((v) => (
          <button key={v} type="button" aria-pressed={verdict === v} onClick={() => setVerdict(verdict === v ? null : v)} className={`chip !min-h-9 !px-3 cursor-pointer ${verdict === v ? "!border-ink !bg-ink !text-bg font-semibold" : ""}`}>
            {VERDICT_LABEL[v]} <span className={`tabular ${verdict === v ? "opacity-80" : "text-ink-3"}`}>{cards.filter((c) => c.verdict === v).length}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by adoption status">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Status</span>
        {STATUSES.map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(status === s ? null : s)} className={`chip !min-h-9 !px-3 cursor-pointer ${status === s ? "!border-ink !bg-ink !text-bg font-semibold" : ""}`}>
            {ADOPTION_STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {shown.length} of {cards.length} candidates shown.
      </p>

      {shown.length === 0 ? (
        <p className="card mt-6 p-5 text-ink-2">No candidates match these filters.</p>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2" data-testid="watchlist">
          {shown.map((c) => (
            <li key={c.slug} className="card lift spot verdict-edge flex flex-col p-5" data-edge={c.verdict ?? "none"} data-testid="candidate-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-lg break-all">
                    <Link href={`/evaluate/${c.slug}`} className="text-ink no-underline hover:underline">
                      {c.fullName}
                    </Link>
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-2">{c.intendedUse || <span className="text-ink-3">No intended use recorded</span>}</p>
                </div>
                <ScoreRing score={c.score} verdict={c.verdict} size={60} stroke={6} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <VerdictChip verdict={c.verdict} />
                <span className="chip">{ADOPTION_STATUS_LABEL[c.adoptionStatus]}</span>
                {c.isExample && <span className="chip chip-dashed">Example, replace me</span>}
              </div>
              {c.topReasons.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {c.topReasons.map((r) => (
                    <li key={r.id} className="flex gap-2">
                      <ReasonTagBadge tag={r.tag} />
                      <span className="text-ink-2">{r.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                <span className="text-xs text-ink-3 tabular">
                  {ago(c.lastChecked)}
                  {c.coverage !== null ? ` · ${Math.round(c.coverage * 100)}% of weight had data` : ""}
                </span>
                <span className="flex items-center gap-2">
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={picked.includes(c.slug)} onChange={() => toggle(c.slug)} disabled={!picked.includes(c.slug) && picked.length >= 4} />
                    Compare
                  </label>
                  <Link href={`/evaluate/${c.slug}`} className="btn btn-secondary btn-sm">
                    Open report <IconArrowRight />
                  </Link>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {picked.length > 0 && (
        <div className="sticky bottom-4 z-20 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3 pl-4 shadow-lg" role="region" aria-label="Comparison selection">
          <p className="text-sm">
            <span className="font-semibold tabular">{picked.length} of 4</span> selected for comparison
          </p>
          <span className="flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked([])}>
              Clear
            </button>
            {picked.length >= 2 ? (
              <Link href={`/evaluate/compare?ids=${picked.join(",")}`} className="btn btn-primary btn-sm">
                Compare {picked.length} side by side
              </Link>
            ) : (
              <span className="btn btn-primary btn-sm" aria-disabled="true">
                Select at least 2
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
