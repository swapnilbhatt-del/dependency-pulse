import { applyGuardrails, type FinalClassification } from "@/lib/ai/guardrails";
import { fallbackAnalysis } from "@/lib/ai/fallback";
import type { ReleaseAnalysis } from "@/lib/ai/schema";
import type { ClassifiedRelease } from "@/lib/digest/model";
import { prescreen } from "@/lib/signals/keywords";
import type { NormalizedRelease, RepoRef } from "@/lib/types";
import { sha256 } from "@/lib/util";

export function repo(over: Partial<RepoRef> = {}): RepoRef {
  const fullName = over.fullName ?? "acme/widget";
  const [owner, name] = fullName.split("/");
  return { id: 1, owner, name, fullName, category: "payments", priority: "normal", enabled: true, ...over };
}

export function release(over: Partial<NormalizedRelease> = {}): NormalizedRelease {
  const body = over.body ?? "Bug fixes.";
  return {
    repoId: 1,
    repoFullName: "acme/widget",
    source: "github_release",
    githubReleaseId: 100,
    tagName: "v1.0.0",
    name: "v1.0.0",
    publishedAt: new Date("2026-10-10T10:00:00Z"),
    prerelease: false,
    draft: false,
    body,
    bodyTruncated: false,
    notesAvailable: body.trim().length > 0,
    bodyHash: sha256(body),
    htmlUrl: "https://github.com/acme/widget/releases/tag/v1.0.0",
    ...over,
  };
}

export function analysis(over: Partial<ReleaseAnalysis> = {}): ReleaseAnalysis {
  return {
    one_line_summary: "Bug fixes.",
    key_changes: [],
    change_type: "fix",
    is_security_fix: false,
    is_breaking_change: false,
    security_evidence: null,
    breaking_evidence: null,
    affected_area: "not stated",
    requires_action: "none",
    confidence: "high",
    ...over,
  };
}

export function classify(r: NormalizedRelease, a: ReleaseAnalysis | null = null, extra: Partial<Parameters<typeof applyGuardrails>[2]> = {}): FinalClassification {
  return applyGuardrails(a ?? fallbackAnalysis(r.body), a ? "ok" : "fallback", {
    title: r.name,
    tagName: r.tagName,
    body: r.body,
    notesAvailable: r.notesAvailable,
    prescreen: prescreen(r.name, r.body),
    advisories: [],
    majorBump: null,
    ...extra,
  });
}

export function classified(
  r: NormalizedRelease,
  a: ReleaseAnalysis | null,
  rp: RepoRef = repo(),
  over: Partial<ClassifiedRelease> = {},
): ClassifiedRelease {
  return { release: r, repo: rp, classification: classify(r, a), advisories: [], history: "new", ...over };
}
