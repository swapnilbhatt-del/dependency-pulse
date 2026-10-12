/**
 * Snapshot completeness rule (pure, tested): a refresh that covers less of the
 * scoring weight than the report currently shown must not replace it silently.
 */
export interface SnapshotLike {
  weightCoverage: number;
  capturedAt: Date;
}

export type SnapshotDecision = { action: "replace" } | { action: "keep_previous"; note: string };

export function decideCurrent(next: SnapshotLike, current: SnapshotLike | null): SnapshotDecision {
  if (!current || next.weightCoverage >= current.weightCoverage) return { action: "replace" };
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return {
    action: "keep_previous",
    note: `The refresh on ${day(next.capturedAt)} reached only ${Math.round(next.weightCoverage * 100)} percent of the scoring weight (the report from ${day(current.capturedAt)} had ${Math.round(current.weightCoverage * 100)} percent), so the earlier, more complete report is still shown.`,
  };
}

/** One snapshot per candidate per ISO week, unless an admin forces a refresh. */
export function shouldRefresh(hasSnapshotThisWeek: boolean, force: boolean): boolean {
  return force || !hasSnapshotThisWeek;
}

export function slugFor(fullName: string): string {
  return fullName.toLowerCase().replace(/[^a-z0-9._-]+/g, "--");
}
