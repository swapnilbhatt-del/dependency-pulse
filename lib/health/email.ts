import "server-only";
import type { WatchlistEmailItem } from "@/lib/digest/render-email";
import { appBaseUrl } from "@/lib/env";
import * as store from "@/lib/health/store";
import { VERDICT_LABEL, type Reason, type Verdict } from "@/lib/health/types";

/** Only these verdicts appear in the email; Healthy candidates stay on the web watchlist. */
const IN_EMAIL: Partial<Record<Verdict, number>> = { risky: 0, watch: 1 };

type Candidate = Pick<store.CandidateRow, "id" | "fullName" | "slug">;
type Snapshot = Pick<store.SnapshotRow, "verdict" | "overallScore" | "reasonsJson">;

/** Risky first, then Watch, then by name. Candidates without a snapshot are left out. */
export function pickEmailItems(candidates: Candidate[], snaps: Map<number, Snapshot>, base: string): WatchlistEmailItem[] {
  return candidates
    .flatMap((c) => {
      const s = snaps.get(c.id);
      const rank = s ? IN_EMAIL[s.verdict] : undefined;
      if (!s || rank === undefined) return [];
      const reasons = (s.reasonsJson as Reason[] | null) ?? [];
      return [{ rank, item: { name: c.fullName, verdict: VERDICT_LABEL[s.verdict], score: s.overallScore ?? null, reason: reasons[0]?.text ?? null, url: `${base}/evaluate/${c.slug}` } }];
    })
    .sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name))
    .map((x) => x.item);
}

/** Compact "Evaluation watchlist" for the Monday email, or null when the flag is off or nothing is Risky or Watch. */
export async function watchlistForEmail(): Promise<WatchlistEmailItem[] | null> {
  if (!(await store.getSetting(store.EMAIL_WATCHLIST_FLAG, false))) return null;
  const candidates = (await store.listCandidates()).filter((c) => c.adoptionStatus === "evaluating" || c.adoptionStatus === "parked");
  const items = pickEmailItems(candidates, await store.currentSnapshots(candidates.map((c) => c.id)), appBaseUrl());
  return items.length ? items : null;
}
