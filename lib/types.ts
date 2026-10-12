export type RepoPriority = "critical" | "normal" | "low";
export type RepoStatus = "ok" | "not_found" | "rate_limited" | "error";
export type ReleaseSource = "github_release" | "tag";

export interface RepoRef {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  category: string;
  priority: RepoPriority;
  enabled: boolean;
}

/** The internal release model produced by the normalizer. */
export interface NormalizedRelease {
  repoId: number;
  repoFullName: string;
  source: ReleaseSource;
  /** GitHub release id, or null for tag-fallback entries. */
  githubReleaseId: number | null;
  tagName: string;
  name: string;
  publishedAt: Date;
  prerelease: boolean;
  draft: boolean;
  body: string;
  bodyTruncated: boolean;
  notesAvailable: boolean;
  bodyHash: string;
  htmlUrl: string;
}

export interface TimeWindow {
  start: Date;
  end: Date;
}

export interface Advisory {
  ghsaId: string;
  cveId: string | null;
  summary: string;
  severity: string | null;
  publishedAt: Date;
  htmlUrl: string;
  patchedVersions: string[];
}

export interface AdvisoryMatch {
  ghsaId: string;
  cveId: string | null;
  summary: string;
  htmlUrl: string;
  severity: string | null;
}
