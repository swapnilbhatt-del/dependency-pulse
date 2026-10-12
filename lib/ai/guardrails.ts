import { fallbackAnalysis, NO_NOTES_SUMMARY } from "@/lib/ai/fallback";
import type { ReleaseAnalysis } from "@/lib/ai/schema";
import { displayEvidence, verifyEvidence } from "@/lib/signals/evidence";
import type { Prescreen } from "@/lib/signals/keywords";
import type { MajorBump } from "@/lib/signals/semver";
import type { AdvisoryMatch } from "@/lib/types";

export type AiStatus = "ok" | "fallback" | "skipped";

export interface Evidence {
  kind: "quote" | "advisory" | "semver";
  text: string;
  url?: string;
}

export interface FinalClassification {
  summary: string;
  keyChanges: string[];
  changeType: ReleaseAnalysis["change_type"];
  affectedArea: string;
  isSecurityFix: boolean;
  isBreakingChange: boolean;
  majorBump: MajorBump | null;
  requiresAction: ReleaseAnalysis["requires_action"];
  confidence: ReleaseAnalysis["confidence"];
  securityEvidence: Evidence[];
  breakingEvidence: Evidence[];
  /** Guardrail decisions, in plain language, for the run log and the "why" line. */
  guardrailNotes: string[];
  unverifiedClaim: "security" | "breaking" | null;
  injectionDetected: boolean;
  aiStatus: AiStatus;
}

export interface GuardrailContext {
  title: string;
  tagName: string;
  body: string;
  notesAvailable: boolean;
  prescreen: Prescreen;
  advisories: AdvisoryMatch[];
  majorBump: MajorBump | null;
}

const ID_TOKEN_RE = /\b(?:CVE-\d{4}-\d{4,}|GHSA(?:-[a-z0-9]{4}){3}|v?\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.]+)?)\b/gi;

/** Every version number or vulnerability id the model mentions must exist in the source. */
export function isGrounded(text: string, source: string): boolean {
  const hay = source.toLowerCase();
  const tokens = text.match(ID_TOKEN_RE) ?? [];
  return tokens.every((t) => hay.includes(t.toLowerCase()) || hay.includes(t.toLowerCase().replace(/^v/, "")));
}

const ACTION_RANK = { none: 0, review: 1, upgrade_now: 2 } as const;
function atLeast(a: ReleaseAnalysis["requires_action"], b: ReleaseAnalysis["requires_action"]) {
  return ACTION_RANK[a] >= ACTION_RANK[b] ? a : b;
}

/**
 * Turns raw model output (or the deterministic fallback) into the classification
 * shown to the reader. The model can never raise a flag on its own: every flag
 * must be backed by the deterministic pre-screen, a GitHub advisory, or a semver
 * major bump, and quoted evidence must exist verbatim in the release notes.
 */
export function applyGuardrails(analysis: ReleaseAnalysis, aiStatus: AiStatus, ctx: GuardrailContext): FinalClassification {
  const notes: string[] = [];
  const source = `${ctx.tagName}\n${ctx.title}\n${ctx.body}`;
  let a = analysis;
  let status = aiStatus;

  if (!ctx.notesAvailable) {
    a = { ...fallbackAnalysis(""), one_line_summary: NO_NOTES_SUMMARY, confidence: "high" };
    status = "skipped";
  } else if (status === "ok") {
    if (!isGrounded(a.one_line_summary, source)) {
      notes.push("Model summary mentioned a version or ID not present in the notes; replaced with the first line of the notes.");
      const fb = fallbackAnalysis(ctx.body);
      a = { ...a, one_line_summary: fb.one_line_summary, confidence: "low" };
    }
    const grounded = a.key_changes.filter((k) => isGrounded(k, source));
    if (grounded.length !== a.key_changes.length) notes.push("Dropped key changes that were not grounded in the notes.");
    a = { ...a, key_changes: grounded };
  }

  let confidence = a.confidence;
  let requiresAction = a.requires_action;
  let unverifiedClaim: FinalClassification["unverifiedClaim"] = null;

  // ── Security ──────────────────────────────────────────────────────────────
  const securityEvidence: Evidence[] = ctx.advisories.map((adv) => ({
    kind: "advisory" as const,
    text: adv.cveId ? `${adv.ghsaId} (${adv.cveId})` : adv.ghsaId,
    url: adv.htmlUrl,
  }));
  const secAllowed = ctx.prescreen.security.length > 0 || ctx.advisories.length > 0;
  const strongSec = ctx.prescreen.security.find((m) => m.strong);
  let isSecurityFix = ctx.advisories.length > 0;

  if (ctx.notesAvailable && a.is_security_fix) {
    if (!secAllowed) {
      notes.push("Model claimed a security fix but the notes contain no security signal; flag rejected.");
    } else if (verifyEvidence(a.security_evidence, ctx.title, ctx.body)) {
      isSecurityFix = true;
      securityEvidence.unshift({ kind: "quote", text: displayEvidence(a.security_evidence!) });
    } else if (!isSecurityFix) {
      notes.push("Model's security evidence was not found in the notes; downgraded to review.");
      unverifiedClaim = "security";
      requiresAction = atLeast(requiresAction, "review");
      confidence = "low";
    }
  }
  if (!isSecurityFix && strongSec) {
    isSecurityFix = true;
    unverifiedClaim = unverifiedClaim === "security" ? null : unverifiedClaim;
    notes.push(`Security flag set by the deterministic pre-screen ("${strongSec.phrase}").`);
  }
  if (isSecurityFix && !securityEvidence.some((e) => e.kind === "quote")) {
    const m = strongSec ?? ctx.prescreen.security[0];
    if (m) securityEvidence.push({ kind: "quote", text: m.phrase });
  }

  // ── Breaking changes ──────────────────────────────────────────────────────
  const breakingEvidence: Evidence[] = [];
  const brkAllowed = ctx.prescreen.breaking.length > 0 || ctx.majorBump !== null;
  const strongBrk = ctx.prescreen.breaking.find((m) => m.strong);
  let isBreakingChange = false;

  if (ctx.notesAvailable && a.is_breaking_change) {
    if (!brkAllowed) {
      notes.push("Model claimed a breaking change but the notes contain no breaking signal; flag rejected.");
    } else if (verifyEvidence(a.breaking_evidence, ctx.title, ctx.body)) {
      isBreakingChange = true;
      breakingEvidence.push({ kind: "quote", text: displayEvidence(a.breaking_evidence!) });
    } else if (ctx.majorBump) {
      isBreakingChange = true;
      notes.push("Breaking change confirmed by the model and a major version bump.");
    } else {
      notes.push("Model's breaking-change evidence was not found in the notes; downgraded to review.");
      unverifiedClaim = unverifiedClaim ?? "breaking";
      requiresAction = atLeast(requiresAction, "review");
      confidence = "low";
    }
  }
  if (!isBreakingChange && strongBrk) {
    isBreakingChange = true;
    notes.push(`Breaking flag set by the deterministic pre-screen ("${strongBrk.phrase}").`);
  }
  if (isBreakingChange && breakingEvidence.length === 0) {
    const m = strongBrk ?? ctx.prescreen.breaking[0];
    if (m) breakingEvidence.push({ kind: "quote", text: m.phrase });
  }
  if (ctx.majorBump) {
    breakingEvidence.push({ kind: "semver", text: `major version bump (v${ctx.majorBump.from} → v${ctx.majorBump.to})` });
  }

  // ── Action level ──────────────────────────────────────────────────────────
  if (requiresAction === "upgrade_now" && !isSecurityFix) {
    requiresAction = "review";
    notes.push('"Upgrade now" requires a verified security fix; lowered to review.');
  }
  if (isSecurityFix) requiresAction = atLeast(requiresAction, "review");

  if (ctx.prescreen.injectionDetected) {
    confidence = "low";
    notes.push("The notes contain instruction-like text; it was ignored and flags were verified deterministically.");
  }

  let changeType = a.change_type;
  if (isSecurityFix) changeType = "security";
  else if (changeType === "security") changeType = "fix";
  if (!isSecurityFix && isBreakingChange) changeType = "breaking";
  else if (!isBreakingChange && changeType === "breaking") changeType = "unknown";

  return {
    summary: a.one_line_summary,
    keyChanges: a.key_changes,
    changeType,
    affectedArea: a.affected_area,
    isSecurityFix,
    isBreakingChange,
    majorBump: ctx.majorBump,
    requiresAction,
    confidence,
    securityEvidence,
    breakingEvidence,
    guardrailNotes: notes,
    unverifiedClaim,
    injectionDetected: ctx.prescreen.injectionDetected,
    aiStatus: status,
  };
}

/**
 * The weekly synthesis may only restate facts from its input: every version,
 * advisory id and number it mentions must appear in the serialized input.
 */
export function isSynthesisGrounded(text: string, inputJson: string): boolean {
  if (!isGrounded(text, inputJson)) return false;
  const numbers = text.replace(ID_TOKEN_RE, " ").match(/\b\d+\b/g) ?? [];
  return numbers.every((n) => new RegExp(`\\b${n}\\b`).test(inputJson));
}
