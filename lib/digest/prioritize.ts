import type { RepoPriority } from "@/lib/types";

export interface Rankable {
  isSecurityFix: boolean;
  isBreakingChange: boolean;
  priority: RepoPriority;
  evidenceCount: number;
  publishedAt: Date;
  repoFullName: string;
}

const PRIORITY_RANK: Record<RepoPriority, number> = { critical: 0, normal: 1, low: 2 };

/**
 * Impact ordering inside a tier: security fixes before breaking changes,
 * critical repos before normal before low, more evidence before less, then
 * newest first, then repo name for a stable order.
 */
export function compareImpact(a: Rankable, b: Rankable): number {
  return (
    Number(b.isSecurityFix) - Number(a.isSecurityFix) ||
    Number(b.isBreakingChange) - Number(a.isBreakingChange) ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    b.evidenceCount - a.evidenceCount ||
    b.publishedAt.getTime() - a.publishedAt.getTime() ||
    a.repoFullName.localeCompare(b.repoFullName)
  );
}

export function prioritize<T extends Rankable>(items: T[]): T[] {
  return [...items].sort(compareImpact);
}
