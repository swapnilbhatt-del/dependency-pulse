import type { FinalClassification } from "@/lib/ai/guardrails";
import type { RepoPriority } from "@/lib/types";

export type Tier = 1 | 2 | 3;
export const TIER_LABEL: Record<Tier, string> = { 1: "Act now", 2: "Review", 3: "FYI" };

type TierInput = Pick<FinalClassification, "isSecurityFix" | "isBreakingChange" | "majorBump" | "requiresAction">;

/**
 * Tier 1 "Act now": security fix, or upgrade_now, or a breaking change in a critical repo.
 * Tier 2 "Review":  breaking change, major version bump, or requires_action = review.
 * Tier 3 "FYI":     everything else.
 */
export function assignTier(c: TierInput, priority: RepoPriority): Tier {
  if (c.isSecurityFix || c.requiresAction === "upgrade_now" || (c.isBreakingChange && priority === "critical")) return 1;
  if (c.isBreakingChange || c.majorBump !== null || c.requiresAction === "review") return 2;
  return 3;
}
