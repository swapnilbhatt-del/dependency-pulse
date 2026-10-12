export function safeTimeZone(tz: string | undefined | null): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** "8 Oct" */
export function fmtShortDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: safeTimeZone(tz) }).format(new Date(iso));
}

/** "8 Oct 2026" */
export function fmtDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: safeTimeZone(tz) }).format(new Date(iso));
}

/** "12 Oct 2026, 09:01" */
export function fmtDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: safeTimeZone(tz),
  }).format(new Date(iso));
}

export function fmtWindow(start: string, end: string, tz: string): string {
  return `${fmtShortDate(start, tz)} – ${fmtDate(end, tz)}`;
}

/** Monday date of the digest week, always shown in UTC to match the ISO week. */
export function fmtWeekOf(iso: string): string {
  return fmtDate(iso, "UTC");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function flagLabels(flags: {
  security: boolean;
  breaking: boolean;
  majorBump: boolean;
  prerelease: boolean;
  lowConfidence: boolean;
  tagOnly: boolean;
  updated: boolean;
  noNotes: boolean;
}): string[] {
  const out: string[] = [];
  if (flags.security) out.push("Security fix");
  if (flags.breaking) out.push("Breaking change");
  if (flags.majorBump) out.push("Major version bump");
  if (flags.updated) out.push("Updated since last digest");
  if (flags.prerelease) out.push("Pre-release");
  if (flags.tagOnly) out.push("Tag (no GitHub Release)");
  if (flags.lowConfidence) out.push("Low confidence, verify before acting");
  return out;
}
