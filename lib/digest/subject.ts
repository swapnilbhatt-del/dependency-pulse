/** "12 Oct 2026" — compact, unambiguous across locales. */
export function formatDay(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

export function digestSubject(actNow: number, review: number, weekOf: Date): string {
  const date = formatDay(weekOf);
  if (actNow === 0 && review === 0) return `[Dependency Pulse] All quiet this week · ${date}`;
  return `[Dependency Pulse] ${actNow} need action · ${review} to review · week of ${date}`;
}

export function statusLine(c: { act: number; review: number; fyi: number; couldNotCheck: number }): string {
  const parts = [`${c.act} need action`, `${c.review} need review`, `${c.fyi} FYI`];
  if (c.couldNotCheck > 0) parts.push(`${c.couldNotCheck} ${c.couldNotCheck === 1 ? "repo" : "repos"} could not be checked`);
  return parts.join(", ");
}
