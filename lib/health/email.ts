import "server-only";
import type { WatchlistEmailItem } from "@/lib/digest/render-email";
import { appBaseUrl } from "@/lib/env";
import * as store from "@/lib/health/store";
import { VERDICT_LABEL, type Reason, type Verdict } from "@/lib/health/types";

const ORDER: Record<Verdict, number> = { risky: 0, watch: 1, insufficient: 2, healthy: 3 };

/** Compact "Evaluation watchlist" for the Monday email, or null when the feature flag is off. */
export async function watchlistForEmail(): Promise<WatchlistEmailItem[] | null> {
  if (!(await store.getSetting(store.EMAIL_WATCHLIST_FLAG, false))) return null;
  const candidates = (await store.listCandidates()).filter((c) => c.adoptionStatus === "evaluating" || c.adoptionStatus === "parked");
  const snaps = await store.currentSnapshots(candidates.map((c) => c.id));
  const base = appBaseUrl();
  return candidates
    .map((c) => {
      const s = snaps.get(c.id);
      const reasons = (s?.reasonsJson as Reason[] | undefined) ?? [];
      return {
        sort: s ? ORDER[s.verdict] : 9,
        item: { name: c.fullName, verdict: s ? VERDICT_LABEL[s.verdict] : "Not checked yet", score: s?.overallScore ?? null, reason: reasons[0]?.text ?? null, url: `${base}/evaluate/${c.slug}` },
      };
    })
    .sort((a, b) => a.sort - b.sort || a.item.name.localeCompare(b.item.name))
    .map((x) => x.item);
}
