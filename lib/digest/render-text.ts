import type { DigestItem, DigestModel } from "@/lib/digest/model";
import type { WatchlistEmailItem } from "@/lib/digest/render-email";
import { flagLabels, fmtDateTime, fmtShortDate, fmtWeekOf, fmtWindow } from "@/lib/digest/format";

function item(i: DigestItem, tz: string): string {
  const lines = [`* ${i.repo} ${i.tag} (${i.category}, ${fmtShortDate(i.publishedAt, tz)})`];
  const flags = flagLabels(i.flags);
  if (flags.length) lines.push(`  [${flags.join("] [")}]`);
  for (const ev of i.evidence.filter((x) => x.kind !== "semver").slice(0, 2)) lines.push(`  Evidence: ${ev.kind === "advisory" ? ev.text : `"${ev.text}"`}`);
  lines.push(`  ${i.summary}`);
  if (i.whyFlagged) lines.push(`  Why: ${i.whyFlagged}`);
  for (const k of i.keyChanges) lines.push(`    - ${k}`);
  if (i.nextStep) lines.push(`  Next step: ${i.nextStep}`);
  if (i.alsoIn.length) lines.push(`  Also in: ${i.alsoIn.join(", ")}`);
  for (const r of i.related ?? []) lines.push(`  Also flagged: ${r.tag}: ${r.summary} (${r.url})`);
  lines.push(`  ${i.url}`);
  return lines.join("\n");
}

export function renderEmailText(d: DigestModel, watchlist?: WatchlistEmailItem[] | null): string {
  const tz = d.timezoneLabel;
  const out: string[] = [];
  out.push(`DEPENDENCY PULSE, WEEK OF ${fmtWeekOf(d.weekOf).toUpperCase()} (${d.isoWeek})`);
  out.push(`${d.statusLine}.`);
  out.push(`Act now: ${d.counts.act} | Review: ${d.counts.review} | FYI: ${d.counts.fyi} | Could not check: ${d.counts.couldNotCheck}`);
  out.push(`Window: ${fmtWindow(d.window.start, d.window.end, tz)} (${tz})`);
  out.push("", "THIS WEEK AT A GLANCE", d.synthesis.paragraph);
  d.synthesis.actions.forEach((a, n) => out.push(`${n + 1}. ${a}`));

  if (d.act.length || d.advisories.length) {
    out.push("", "== ACT NOW ==");
    d.act.forEach((i) => out.push(item(i, tz), ""));
    d.advisories.forEach((a) => out.push(`* ${a.repo}: advisory ${a.ghsaId}${a.cveId ? ` (${a.cveId})` : ""}`, `  ${a.summary}`, `  ${a.url}`, ""));
  }
  if (d.review.length) {
    out.push("", "== REVIEW ==");
    d.review.forEach((i) => out.push(item(i, tz), ""));
  }
  if (d.updated.length) {
    out.push("", "== UPDATED SINCE LAST DIGEST ==");
    d.updated.forEach((i) => out.push(item(i, tz), ""));
  }
  if (d.fyi.length) {
    out.push("", "== FYI ==");
    for (const g of d.fyi) {
      out.push(`-- ${g.category} (${g.coverage.reposChecked} repos checked) --`);
      for (const i of g.items) out.push(`* ${i.repo} ${i.tag}${i.flags.prerelease ? " (Pre-release)" : ""}${i.flags.tagOnly ? " (Tag, no GitHub Release)" : ""}, ${fmtShortDate(i.publishedAt, tz)}: ${i.summary}`, `  ${i.url}`);
      for (const x of g.earlier) out.push(`  +${x.tags.length} earlier releases of ${x.repo}: ${x.tags.join(", ")}`);
    }
  }
  if (d.couldNotCheck.length) {
    out.push("", "== COULD NOT CHECK ==");
    d.couldNotCheck.forEach((c) => out.push(`* ${c.repo}: ${c.reason}`));
  }
  if (d.quiet.length) out.push("", `Quiet this week (checked, no releases): ${d.quiet.join(", ")}`);
  if (d.alreadyReported.length) out.push(`Already covered in an earlier digest: ${d.alreadyReported.map((a) => `${a.repo} ${a.tag}`).join(", ")}`);
  if (watchlist && watchlist.length) {
    out.push("", "== EVALUATION WATCHLIST ==", "Candidates marked Risky or Watch. Healthy candidates are on the web watchlist.");
    for (const w of watchlist) out.push(`* ${w.name}: ${w.verdict}${w.score !== null ? ` (${w.score})` : ""}`, ...(w.reason ? [`  ${w.reason}`] : []), `  ${w.url}`);
  }
  out.push("", "--", `${d.counts.reposChecked} repos checked, ${d.counts.releasesFound} releases found, ${d.counts.aiFallbacks} AI fallbacks, run ${fmtDateTime(d.generatedAt, tz)} (${tz}).`);
  d.notices.forEach((n) => out.push(n));
  out.push(`Web: ${d.links.digest}`, `Archive: ${d.links.archive}`, `Manage repositories: ${d.links.admin}`);
  return out.join("\n");
}
