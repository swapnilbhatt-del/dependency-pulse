import type { FinalClassification } from "@/lib/ai/guardrails";
import type { RepoPriority } from "@/lib/types";
import { clampText } from "@/lib/util";

/** The evidence block shows the full line; the sentence keeps a short excerpt. */
const q = (e: { text: string; phrase?: string }) => clampText(e.phrase ?? e.text, 70);

function area(c: FinalClassification): string | null {
  const a = c.affectedArea.trim();
  return a && !/^not stated$/i.test(a) ? a : null;
}

/** One plain sentence saying why an item sits in Act now or Review, using verified evidence only. */
export function whyFlagged(c: FinalClassification, priority: RepoPriority): string | null {
  const adv = c.securityEvidence.find((e) => e.kind === "advisory");
  const secQuote = c.securityEvidence.find((e) => e.kind === "quote");
  const brkQuote = c.breakingEvidence.find((e) => e.kind === "quote");
  const where = area(c);

  if (c.isSecurityFix) {
    if (adv && secQuote) return `Flagged because GitHub advisory ${adv.text} matches this release and the notes say “${q(secQuote)}”.`;
    if (adv) return `Flagged because GitHub advisory ${adv.text} matches this release.`;
    if (secQuote) return `Flagged because the notes say “${q(secQuote)}”${where ? ` (affects ${where})` : ""}.`;
  }
  if (c.isBreakingChange) {
    const crit = priority === "critical" ? " in a repository marked critical" : "";
    if (brkQuote) return `Flagged because the notes say “${q(brkQuote)}”${crit}.`;
    if (c.majorBump) return `Flagged because the version moves from v${c.majorBump.from} to v${c.majorBump.to}${crit}.`;
  }
  if (c.majorBump) return `Flagged because the version moves from v${c.majorBump.from} to v${c.majorBump.to}, a major version bump.`;
  if (c.unverifiedClaim) {
    return `Flagged for review because the analysis reported a ${c.unverifiedClaim === "security" ? "security fix" : "breaking change"}, but its quoted evidence was not found in the notes.`;
  }
  if (c.requiresAction !== "none") return `Flagged for review because the analysis recommends checking the changes${where ? ` to ${where}` : ""}.`;
  return null;
}

/** A short, generic next step grounded in the release, never inventing versions. */
export function nextStep(c: FinalClassification, repo: string, tag: string): string | null {
  if (c.isSecurityFix) return `Check whether your pinned version of ${repo} is below ${tag}, and upgrade if it is.`;
  if (c.isBreakingChange) return `Read the migration notes for ${tag} before upgrading ${repo}, and keep your current range pinned until call sites are checked.`;
  if (c.majorBump) return `Treat ${tag} as a major upgrade: review the release notes before widening your version range.`;
  if (c.unverifiedClaim) return `Open the release notes for ${tag} and confirm the claim yourself before acting.`;
  if (c.requiresAction === "review") return `Skim the ${tag} notes${area(c) ? ` for changes to ${area(c)}` : ""} before your next upgrade.`;
  return null;
}
