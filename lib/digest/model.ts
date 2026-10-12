import type { Evidence, FinalClassification } from "@/lib/ai/guardrails";
import type { Tier } from "@/lib/digest/tiers";
import type { HistoryStatus } from "@/lib/filter/filter";
import type { AdvisoryMatch, NormalizedRelease, RepoRef, RepoStatus, TimeWindow } from "@/lib/types";

/** Everything the builder needs about one in-window release. */
export interface ClassifiedRelease {
  release: NormalizedRelease;
  repo: RepoRef;
  classification: FinalClassification;
  advisories: AdvisoryMatch[];
  history: HistoryStatus;
}

export interface RepoOutcome {
  repo: RepoRef;
  status: RepoStatus;
  error: string | null;
  releaseCount: number;
  usedTagFallback: boolean;
}

/** Serializable digest model, stored as JSON and rendered by both web and email renderers. */
export interface DigestItem {
  id: string;
  repo: string;
  category: string;
  priority: RepoRef["priority"];
  tag: string;
  name: string;
  url: string;
  publishedAt: string;
  source: NormalizedRelease["source"];
  tier: Tier;
  flags: {
    security: boolean;
    breaking: boolean;
    majorBump: boolean;
    prerelease: boolean;
    lowConfidence: boolean;
    tagOnly: boolean;
    updated: boolean;
    noNotes: boolean;
    injection: boolean;
  };
  summary: string;
  keyChanges: string[];
  evidence: Evidence[];
  whyFlagged: string | null;
  nextStep: string | null;
  changeType: FinalClassification["changeType"];
  affectedArea: string;
  confidence: FinalClassification["confidence"];
  aiStatus: FinalClassification["aiStatus"];
  /** Older releases in the same week that carried the same advisory or change. */
  alsoIn: string[];
}

export interface AdvisoryNotice {
  repo: string;
  category: string;
  ghsaId: string;
  cveId: string | null;
  summary: string;
  url: string;
  severity: string | null;
}

export interface FyiGroup {
  category: string;
  coverage: { reposChecked: number; releases: number };
  items: DigestItem[];
  earlier: { repo: string; tags: string[] }[];
}

export interface DigestModel {
  version: 1;
  isoWeek: string;
  weekOf: string;
  window: { start: string; end: string };
  generatedAt: string;
  timezoneLabel: string;
  counts: {
    act: number;
    review: number;
    fyi: number;
    updated: number;
    couldNotCheck: number;
    reposChecked: number;
    releasesFound: number;
    aiFallbacks: number;
  };
  statusLine: string;
  subject: string;
  synthesis: { paragraph: string; actions: string[]; source: "ai" | "deterministic" };
  act: DigestItem[];
  advisories: AdvisoryNotice[];
  review: DigestItem[];
  updated: DigestItem[];
  fyi: FyiGroup[];
  alreadyReported: { repo: string; tag: string; url: string }[];
  couldNotCheck: { repo: string; reason: string }[];
  quiet: string[];
  coverage: { category: string; reposChecked: number; releases: number }[];
  notices: string[];
  links: { digest: string; archive: string; admin: string };
}

export interface BuildInput {
  isoWeek: string;
  weekOf: Date;
  window: TimeWindow;
  generatedAt: Date;
  timezoneLabel: string;
  baseUrl: string;
  releases: ClassifiedRelease[];
  repoOutcomes: RepoOutcome[];
  advisoryOnly: { repo: RepoRef; advisory: AdvisoryMatch }[];
  synthesis?: { paragraph: string; actions: string[] } | null;
  aiFallbacks: number;
  aiUnavailable?: boolean;
}
