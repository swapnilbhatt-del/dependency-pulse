import type { DigestItem, DigestModel } from "@/lib/digest/model";
import { escapeHtml as e, flagLabels, fmtDateTime, fmtShortDate, fmtWeekOf, fmtWindow } from "@/lib/digest/format";
import { safeGithubUrl } from "@/lib/util";

/**
 * HTML email: table layout, inline CSS only, no web fonts, images or scripts.
 * Colors are mid-tones chosen to stay legible when clients apply dark mode.
 * Every dynamic string is escaped; release-note text is never inserted as HTML.
 */

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const C = {
  ink: "#1f2328",
  ink2: "#4b5058",
  ink3: "#5f646c",
  line: "#d9d5cc",
  paper: "#ffffff",
  fill: "#f4f2ed",
  act: "#b0241c",
  actBg: "#fdecea",
  review: "#85500a",
  reviewBg: "#fff4dc",
  accent: "#1d5ba8",
};

function link(url: string | null, label: string, style = ""): string {
  if (!url) return e(label);
  return `<a href="${e(url)}" style="color:${C.accent};text-decoration:underline;${style}">${e(label)}</a>`;
}

function chips(item: DigestItem): string {
  return flagLabels(item.flags)
    .map((l) => `<span style="display:inline-block;margin:0 6px 4px 0;padding:1px 8px;border:1px solid ${C.line};border-radius:10px;font-size:12px;color:${C.ink2};">${e(l)}</span>`)
    .join("");
}

function evidence(item: DigestItem, color: string): string {
  const ev = item.evidence.filter((x) => x.kind !== "semver").slice(0, 2);
  if (!ev.length) return "";
  return ev
    .map((x) => {
      const url = x.url ? safeGithubUrl(x.url) : null;
      const text = x.kind === "advisory" ? link(url, x.text) : `“${e(x.text)}”`;
      return `<div style="margin:8px 0 0;padding:6px 10px;border-left:3px solid ${color};background:${C.fill};font-family:${MONO};font-size:13px;color:${C.ink};">${text}</div>`;
    })
    .join("");
}

function card(item: DigestItem, tz: string, color: string, bg: string, label: string): string {
  const url = safeGithubUrl(item.url);
  const keyChanges = item.keyChanges.length
    ? `<ul style="margin:8px 0 0 18px;padding:0;color:${C.ink2};font-size:14px;line-height:1.5;">${item.keyChanges.map((k) => `<li>${e(k)}</li>`).join("")}</ul>`
    : "";
  const also =
    (item.alsoIn.length ? `<div style="margin-top:6px;font-size:12px;color:${C.ink3};">Also in ${e(item.alsoIn.join(", "))}</div>` : "") +
    (item.related?.length
      ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid ${C.line};font-size:13px;color:${C.ink2};"><strong>Also flagged this week:</strong>${item.related
          .map((r) => `<div style="margin-top:4px;"><span style="font-family:${MONO};">${e(r.tag)}</span>: ${e(r.summary)} ${link(safeGithubUrl(r.url), "Notes")}</div>`)
          .join("")}</div>`
      : "");
  return `
<tr><td style="padding:0 0 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-left:4px solid ${color};border-radius:8px;background:${C.paper};">
    <tr><td style="padding:14px 16px;font-family:${FONT};">
      <div style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${color};background:${bg};display:inline-block;padding:2px 8px;border-radius:4px;">${e(label)}</div>
      <div style="margin:8px 0 2px;font-size:16px;font-weight:600;color:${C.ink};">${e(item.repo)} <span style="font-family:${MONO};font-weight:500;">${e(item.tag)}</span></div>
      <div style="font-size:12px;color:${C.ink3};margin-bottom:6px;">${e(item.category)} · ${e(fmtShortDate(item.publishedAt, tz))}</div>
      <div>${chips(item)}</div>
      ${evidence(item, color)}
      <p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:${C.ink};">${e(item.summary)}</p>
      ${item.whyFlagged ? `<p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:${C.ink2};">${e(item.whyFlagged)}</p>` : ""}
      ${keyChanges}
      ${item.nextStep ? `<p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:${C.ink};"><strong>Next step:</strong> ${e(item.nextStep)}</p>` : ""}
      ${also}
      <p style="margin:10px 0 0;font-size:13px;">${link(url, "Read the release notes →")}</p>
    </td></tr>
  </table>
</td></tr>`;
}

function section(title: string, intro: string, body: string): string {
  return `
<tr><td style="padding:24px 0 8px;font-family:${FONT};">
  <h2 style="margin:0;font-size:18px;color:${C.ink};">${e(title)}</h2>
  <p style="margin:4px 0 0;font-size:13px;color:${C.ink3};">${e(intro)}</p>
</td></tr>${body}`;
}

function countCell(n: number, label: string, color: string): string {
  return `<td width="25%" style="padding:10px 6px;text-align:center;font-family:${FONT};border:1px solid ${C.line};background:${C.paper};">
    <div style="font-size:26px;font-weight:700;color:${color};">${n}</div>
    <div style="font-size:12px;color:${C.ink2};">${e(label)}</div></td>`;
}

/** Optional "Evaluation watchlist" block (Adoption Check), only when the admin feature flag is on. */
export interface WatchlistEmailItem {
  name: string;
  verdict: string; // label, e.g. "Watch"
  score: number | null;
  reason: string | null;
  url: string;
}

function watchlistSection(items: WatchlistEmailItem[]): string {
  const rows = items
    .map(
      (i) => `<tr><td style="padding:8px 0;border-top:1px solid ${C.line};font-family:${FONT};font-size:14px;color:${C.ink};">
  <strong>${e(i.name)}</strong> <span style="display:inline-block;margin-left:6px;padding:1px 8px;border:1px solid ${C.line};border-radius:10px;font-size:12px;color:${C.ink2};">${e(i.verdict)}${i.score !== null ? ` · ${i.score}` : ""}</span>
  ${i.reason ? `<div style="color:${C.ink2};margin-top:2px;line-height:1.45;">${e(i.reason)}</div>` : ""}
  <div style="margin-top:2px;font-size:12px;">${link(i.url, "Open the report")}</div></td></tr>`,
    )
    .join("");
  return section("Evaluation watchlist", "Open-source projects the team is considering, with their current health verdict.", `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`);
}

export function renderEmailHtml(d: DigestModel, watchlist?: WatchlistEmailItem[] | null): string {
  const tz = d.timezoneLabel;
  const act =
    d.act.map((i) => card(i, tz, C.act, C.actBg, i.flags.security ? "Act now · Security fix" : "Act now")).join("") +
    d.advisories
      .map(
        (a) => `
<tr><td style="padding:0 0 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-left:4px solid ${C.act};border-radius:8px;background:${C.paper};"><tr><td style="padding:14px 16px;font-family:${FONT};">
  <div style="font-size:12px;font-weight:600;text-transform:uppercase;color:${C.act};">Act now · Security advisory</div>
  <div style="margin:8px 0 2px;font-size:16px;font-weight:600;color:${C.ink};">${e(a.repo)}</div>
  <div style="margin:8px 0 0;padding:6px 10px;border-left:3px solid ${C.act};background:${C.fill};font-family:${MONO};font-size:13px;">${link(safeGithubUrl(a.url), a.cveId ? `${a.ghsaId} (${a.cveId})` : a.ghsaId)}</div>
  <p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:${C.ink};">${e(a.summary)}</p>
  <p style="margin:6px 0 0;font-size:13px;color:${C.ink2};">Published this week; no release in the window matched its patched version. Check the advisory for affected versions.</p>
</td></tr></table></td></tr>`,
      )
      .join("");
  const review = d.review.map((i) => card(i, tz, C.review, C.reviewBg, "Review")).join("");
  const updated = d.updated.map((i) => card(i, tz, C.ink2, C.fill, "Updated since last digest")).join("");

  const fyi = d.fyi
    .map((g) => {
      const rows = g.items
        .map(
          (i) => `<tr>
  <td style="padding:8px 8px 8px 0;border-top:1px solid ${C.line};font-family:${FONT};font-size:14px;color:${C.ink};vertical-align:top;">
    <strong>${e(i.repo)}</strong> <span style="font-family:${MONO};">${e(i.tag)}</span>${i.flags.prerelease ? ` <span style="font-size:12px;color:${C.ink3};">(Pre-release)</span>` : ""}${i.flags.tagOnly ? ` <span style="font-size:12px;color:${C.ink3};">(Tag, no GitHub Release)</span>` : ""}
    <div style="color:${C.ink2};margin-top:2px;line-height:1.45;">${e(i.summary)}</div>
  </td>
  <td style="padding:8px 0;border-top:1px solid ${C.line};font-family:${FONT};font-size:12px;color:${C.ink3};white-space:nowrap;vertical-align:top;text-align:right;">${e(fmtShortDate(i.publishedAt, tz))}<br>${link(safeGithubUrl(i.url), "Notes")}</td>
</tr>`,
        )
        .join("");
      const earlier = g.earlier.map((x) => `<tr><td colspan="2" style="padding:4px 0;font-family:${FONT};font-size:12px;color:${C.ink3};">+${x.tags.length} earlier ${x.tags.length === 1 ? "release" : "releases"} of ${e(x.repo)}: ${e(x.tags.join(", "))}</td></tr>`).join("");
      return `<tr><td style="padding:10px 0 0;">
  <div style="font-family:${FONT};font-size:13px;font-weight:600;color:${C.ink};text-transform:capitalize;">${e(g.category)} <span style="font-weight:400;color:${C.ink3};text-transform:none;">· ${g.coverage.reposChecked} repos checked, ${g.items.length + g.earlier.reduce((n, x) => n + x.tags.length, 0)} releases</span></div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${earlier}</table>
</td></tr>`;
    })
    .join("");

  const could = d.couldNotCheck.length
    ? section(
        "Could not check",
        "These repositories were skipped this week. Everything else was checked.",
        `<tr><td style="font-family:${FONT};font-size:14px;color:${C.ink};"><ul style="margin:0 0 0 18px;padding:0;">${d.couldNotCheck.map((c) => `<li style="margin-bottom:4px;"><strong>${e(c.repo)}</strong>: ${e(c.reason)}</li>`).join("")}</ul></td></tr>`,
      )
    : "";

  const quietAll = d.counts.releasesFound === 0 && d.advisories.length === 0;
  const quietLine = d.quiet.length
    ? `<tr><td style="padding:16px 0 0;font-family:${FONT};font-size:13px;color:${C.ink2};line-height:1.5;"><strong>${quietAll ? "All tracked repositories were checked and none published a release this week" : "Quiet this week"}:</strong> ${e(d.quiet.join(", "))}</td></tr>`
    : "";

  const actions = d.synthesis.actions.length
    ? `<ol style="margin:8px 0 0 18px;padding:0;font-size:14px;line-height:1.5;color:${C.ink};">${d.synthesis.actions.map((a) => `<li>${e(a)}</li>`).join("")}</ol>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${e(d.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.fill};">
<div style="display:none;max-height:0;overflow:hidden;">${e(d.statusLine)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.fill};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="font-family:${FONT};padding-bottom:12px;">
  <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${C.ink3};">Weekly release digest · ${e(d.isoWeek)}</div>
  <h1 style="margin:6px 0 4px;font-size:24px;line-height:1.25;color:${C.ink};">Dependency Pulse, week of ${e(fmtWeekOf(d.weekOf))}</h1>
  <p style="margin:0;font-size:14px;color:${C.ink2};">${e(d.statusLine)}.</p>
</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  ${countCell(d.counts.act, "Act now", C.act)}${countCell(d.counts.review, "Review", C.review)}${countCell(d.counts.fyi, "FYI", C.ink)}${countCell(d.counts.couldNotCheck, "Could not check", C.ink2)}
</tr></table></td></tr>
<tr><td style="padding:8px 0 0;font-family:${FONT};font-size:12px;color:${C.ink3};">Window ${e(fmtWindow(d.window.start, d.window.end, tz))} (${e(tz)}) · generated ${e(fmtDateTime(d.generatedAt, tz))}</td></tr>
<tr><td style="padding:16px;margin-top:12px;font-family:${FONT};background:${C.paper};border:1px solid ${C.line};border-radius:8px;">
  <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:${C.ink3};">This week at a glance</div>
  <p style="margin:6px 0 0;font-size:15px;line-height:1.55;color:${C.ink};">${e(d.synthesis.paragraph)}</p>${actions}
</td></tr>
${d.act.length || d.advisories.length ? section("Act now", "Security fixes and urgent upgrades. Verify the quoted evidence, then act.", act) : ""}
${d.review.length ? section("Review", "Breaking changes, major version bumps, and items worth a closer look.", review) : ""}
${d.updated.length ? section("Updated since last digest", "Releases already reported whose notes changed since.", updated) : ""}
${d.fyi.length ? section("FYI", "Everything else that shipped, grouped by the part of the product it touches.", fyi) : ""}
${could}
${quietLine}
${d.alreadyReported.length ? `<tr><td style="padding:12px 0 0;font-family:${FONT};font-size:12px;color:${C.ink3};">Already covered in an earlier digest: ${e(d.alreadyReported.map((a) => `${a.repo} ${a.tag}`).join(", "))}</td></tr>` : ""}${watchlist && watchlist.length ? watchlistSection(watchlist) : ""}
<tr><td style="padding:24px 0 0;border-top:1px solid ${C.line};font-family:${FONT};font-size:12px;line-height:1.6;color:${C.ink3};">
  ${d.counts.reposChecked} repos checked · ${d.counts.releasesFound} releases found · ${d.counts.aiFallbacks} AI fallbacks · run ${e(fmtDateTime(d.generatedAt, tz))} (${e(tz)})<br>
  ${d.notices.map((n) => `${e(n)}<br>`).join("")}
  ${link(d.links.digest, "View this digest on the web")} · ${link(d.links.archive, "Archive")} · ${link(d.links.admin, "Manage repositories")}<br>
  Summaries are generated by Gemini Flash from the release notes and checked against them. Flags require quoted evidence or a GitHub advisory.
</td></tr>
</table></td></tr></table></body></html>`;
}
