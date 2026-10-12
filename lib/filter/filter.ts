import { DISPLAY_CAP_PER_REPO } from "@/lib/config";
import { isInWindow } from "@/lib/filter/window";
import type { NormalizedRelease, TimeWindow } from "@/lib/types";

export interface FilterResult {
  included: NormalizedRelease[];
  excluded: { draft: number; outOfWindow: number; duplicate: number };
}

export function releaseKey(r: Pick<NormalizedRelease, "repoId" | "tagName">): string {
  return `${r.repoId}:${r.tagName}`;
}

/**
 * Deterministic inclusion rules. Drafts are dropped, prereleases kept,
 * anything outside the window dropped, and duplicates (same GitHub release id,
 * or same repo + tag) collapsed. Output is newest first.
 */
export function filterReleases(releases: NormalizedRelease[], window: TimeWindow): FilterResult {
  const excluded = { draft: 0, outOfWindow: 0, duplicate: 0 };
  const seenIds = new Set<number>();
  const seenKeys = new Set<string>();
  const included: NormalizedRelease[] = [];
  for (const r of releases) {
    if (r.draft) {
      excluded.draft++;
      continue;
    }
    if (!isInWindow(r.publishedAt, window)) {
      excluded.outOfWindow++;
      continue;
    }
    const key = releaseKey(r);
    if ((r.githubReleaseId !== null && seenIds.has(r.githubReleaseId)) || seenKeys.has(key)) {
      excluded.duplicate++;
      continue;
    }
    if (r.githubReleaseId !== null) seenIds.add(r.githubReleaseId);
    seenKeys.add(key);
    included.push(r);
  }
  included.sort(byNewest);
  return { included, excluded };
}

export function byNewest(a: { publishedAt: Date }, b: { publishedAt: Date }): number {
  return b.publishedAt.getTime() - a.publishedAt.getTime();
}

/** Latest `cap` entries are shown; the rest are summarized as "+N earlier releases". */
export function capPerRepo<T extends { publishedAt: Date | string }>(items: T[], cap: number = DISPLAY_CAP_PER_REPO) {
  const t = (x: T) => new Date(x.publishedAt).getTime();
  const sorted = [...items].sort((a, b) => t(b) - t(a));
  return { shown: sorted.slice(0, cap), earlier: sorted.slice(cap) };
}

export type HistoryStatus = "new" | "updated" | "already_reported";

/**
 * Change-aware dedupe across digests. `previous` maps repoId:tag to the body
 * hash reported in an earlier digest.
 */
export function classifyAgainstHistory(r: NormalizedRelease, previous: Map<string, string>): HistoryStatus {
  const prior = previous.get(releaseKey(r));
  if (prior === undefined) return "new";
  return prior === r.bodyHash ? "already_reported" : "updated";
}
