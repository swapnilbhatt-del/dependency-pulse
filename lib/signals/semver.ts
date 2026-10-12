export interface ParsedVersion {
  /** Anything before the version, e.g. "drizzle-orm@" or "@prisma/client@". Leading "v" is not part of it. */
  prefix: string;
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
}

const VERSION_RE = /^(?<prefix>.*?)(?:v|V)?(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?(?:[-+](?<pre>[0-9A-Za-z.+-]+))?$/;

/** Parse a tag like "v1.2.3", "1.2.3-rc.1", "drizzle-orm@0.45.0". Returns null if no semver core is found. */
export function parseVersion(tag: string): ParsedVersion | null {
  const m = VERSION_RE.exec(tag.trim());
  if (!m?.groups) return null;
  return {
    prefix: m.groups.prefix,
    major: Number(m.groups.major),
    minor: Number(m.groups.minor),
    patch: m.groups.patch ? Number(m.groups.patch) : 0,
    pre: m.groups.pre ?? null,
  };
}

/** "1.2.3" or "1.2.3-rc.1" (no prefix, no "v"). */
export function versionCore(v: ParsedVersion): string {
  return `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ""}`;
}

export interface MajorBump {
  from: number;
  to: number;
}

/**
 * A release is a major bump when its major version is greater than the highest
 * major seen in earlier releases of the same package prefix. Using the max
 * (not just the immediately previous tag) avoids false positives in repos that
 * ship several release lines in parallel (e.g. nodejs/node v22.x and v24.x).
 */
export function detectMajorBump(tag: string, earlierTags: string[]): MajorBump | null {
  const v = parseVersion(tag);
  if (!v) return null;
  let maxMajor = -1;
  for (const t of earlierTags) {
    const p = parseVersion(t);
    if (p && p.prefix === v.prefix && p.major > maxMajor) maxMajor = p.major;
  }
  if (maxMajor < 0) return null;
  return v.major > maxMajor ? { from: maxMajor, to: v.major } : null;
}
