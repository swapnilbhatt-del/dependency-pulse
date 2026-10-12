import { CATEGORY_ORDER, DISPLAY_CAP_PER_REPO } from "@/lib/config";
import { nextStep, whyFlagged } from "@/lib/digest/explain";
import type {
  AdvisoryNotice,
  BuildInput,
  ClassifiedRelease,
  DigestItem,
  DigestModel,
  FyiGroup,
} from "@/lib/digest/model";
import { compareImpact, type Rankable } from "@/lib/digest/prioritize";
import { digestSubject, statusLine } from "@/lib/digest/subject";
import { assignTier } from "@/lib/digest/tiers";
import { capPerRepo } from "@/lib/filter/filter";
import { plural } from "@/lib/util";

const STATUS_REASON: Record<string, string> = {
  not_found: "Repository not found or not accessible (404). It may have been renamed, deleted, or made private.",
  rate_limited: "GitHub rate limit reached before this repository could be checked.",
  error: "GitHub request failed.",
};

export function toItem(c: ClassifiedRelease): DigestItem {
  const k = c.classification;
  const tier = assignTier(k, c.repo.priority);
  return {
    id: `${c.repo.id}:${c.release.tagName}`,
    repo: c.repo.fullName,
    category: c.repo.category || "uncategorized",
    priority: c.repo.priority,
    tag: c.release.tagName,
    name: c.release.name,
    url: c.release.htmlUrl,
    publishedAt: c.release.publishedAt.toISOString(),
    source: c.release.source,
    tier,
    flags: {
      security: k.isSecurityFix,
      breaking: k.isBreakingChange,
      majorBump: k.majorBump !== null,
      prerelease: c.release.prerelease,
      lowConfidence: k.confidence === "low" && k.aiStatus !== "skipped",
      tagOnly: c.release.source === "tag",
      updated: c.history === "updated",
      noNotes: !c.release.notesAvailable,
      injection: k.injectionDetected,
    },
    summary: k.summary,
    keyChanges: k.keyChanges,
    evidence: [...k.securityEvidence, ...k.breakingEvidence],
    whyFlagged: tier < 3 ? whyFlagged(k, c.repo.priority) : null,
    nextStep: tier < 3 ? nextStep(k, c.repo.fullName, c.release.tagName) : null,
    changeType: k.changeType,
    affectedArea: k.affectedArea,
    confidence: k.confidence,
    aiStatus: k.aiStatus,
    alsoIn: [],
  };
}

function rankable(i: DigestItem): Rankable {
  return {
    isSecurityFix: i.flags.security,
    isBreakingChange: i.flags.breaking,
    priority: i.priority,
    evidenceCount: i.evidence.length,
    publishedAt: new Date(i.publishedAt),
    repoFullName: i.repo,
  };
}

export function sortByImpact(items: DigestItem[]): DigestItem[] {
  return [...items].sort((a, b) => compareImpact(rankable(a), rankable(b)));
}

function evidenceKeys(i: DigestItem): string[] {
  return i.evidence
    .filter((e) => e.kind !== "semver")
    .map((e) => `${e.kind}:${e.text.toLowerCase().replace(/\s+/g, " ").trim()}`);
}

/**
 * Duplicate collapse: inside one repo, when an older flagged release carries
 * only evidence already shown on a newer one (same advisory, same quoted
 * change), it is folded into the newer card as "also in <tag>". For FYI items,
 * identical summaries are folded the same way. Nothing is dropped: folded tags
 * stay visible on the surviving card.
 */
export function collapseDuplicates(items: DigestItem[]): DigestItem[] {
  const byRepo = new Map<string, DigestItem[]>();
  for (const i of items) byRepo.set(i.repo, [...(byRepo.get(i.repo) ?? []), { ...i, alsoIn: [...i.alsoIn] }]);
  const out: DigestItem[] = [];
  for (const list of byRepo.values()) {
    list.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const kept: DigestItem[] = [];
    for (const item of list) {
      const keys = item.tier < 3 ? evidenceKeys(item) : [`summary:${item.summary.toLowerCase()}`];
      const host =
        keys.length > 0 && !item.flags.noNotes
          ? kept.find((k) => {
              if (k.tier > item.tier) return false;
              const hostKeys = k.tier < 3 ? evidenceKeys(k) : [`summary:${k.summary.toLowerCase()}`];
              return keys.every((key) => hostKeys.includes(key));
            })
          : undefined;
      if (host) host.alsoIn.push(item.tag, ...item.alsoIn);
      else kept.push(item);
    }
    out.push(...kept);
  }
  return out;
}

function categoryRank(c: string): number {
  const i = CATEGORY_ORDER.indexOf(c);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

function deterministicSynthesis(model: Pick<DigestModel, "act" | "review" | "advisories" | "counts">) {
  const top = model.act[0] ?? model.review[0];
  const sentences: string[] = [];
  if (top) {
    const why = top.flags.security ? "a security fix" : top.flags.breaking ? "a breaking change" : top.flags.majorBump ? "a major version bump" : "a release to review";
    sentences.push(`Most important: ${top.repo} ${top.tag} is ${why}.`);
  } else if (model.advisories[0]) {
    sentences.push(`Most important: GitHub advisory ${model.advisories[0].ghsaId} was published for ${model.advisories[0].repo}.`);
  }
  sentences.push(
    `${plural(model.counts.releasesFound, "release")} across ${plural(model.counts.reposChecked, "repository", "repositories")} checked: ${model.counts.act} need action, ${model.counts.review} need review, ${model.counts.fyi} FYI.`,
  );
  if (!top && model.counts.releasesFound === 0) sentences.unshift("All quiet: no new releases this week.");
  const seen = new Set<string>();
  const actions = [...model.act, ...model.review]
    .filter((i) => !seen.has(i.repo) && Boolean(seen.add(i.repo)))
    .slice(0, 5)
    .map((i) => i.nextStep)
    .filter((s): s is string => Boolean(s));
  return { paragraph: sentences.slice(0, 3).join(" "), actions, source: "deterministic" as const };
}

export function buildDigest(input: BuildInput): DigestModel {
  const items = input.releases.map(toItem);

  const newOrUpdated = items.filter((_, idx) => input.releases[idx].history !== "already_reported");
  const alreadyReported = input.releases
    .filter((r) => r.history === "already_reported")
    .map((r) => ({ repo: r.repo.fullName, tag: r.release.tagName, url: r.release.htmlUrl }));

  const collapsed = collapseDuplicates(newOrUpdated);
  const act = sortByImpact(collapsed.filter((i) => i.tier === 1));
  const updated = sortByImpact(collapsed.filter((i) => i.tier > 1 && i.flags.updated));
  const review = sortByImpact(collapsed.filter((i) => i.tier === 2 && !i.flags.updated));
  const fyiItems = collapsed.filter((i) => i.tier === 3 && !i.flags.updated);

  // Coverage per category, over every enabled repo that was attempted.
  const coverageMap = new Map<string, { reposChecked: number; releases: number }>();
  for (const o of input.repoOutcomes) {
    const cat = o.repo.category || "uncategorized";
    const cur = coverageMap.get(cat) ?? { reposChecked: 0, releases: 0 };
    if (o.status === "ok") cur.reposChecked++;
    cur.releases += o.releaseCount;
    coverageMap.set(cat, cur);
  }
  const coverage = [...coverageMap.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category));

  const fyiByCategory = new Map<string, DigestItem[]>();
  for (const i of fyiItems) fyiByCategory.set(i.category, [...(fyiByCategory.get(i.category) ?? []), i]);
  const fyi: FyiGroup[] = [...fyiByCategory.entries()]
    .sort(([a], [b]) => categoryRank(a) - categoryRank(b) || a.localeCompare(b))
    .map(([category, list]) => {
      const byRepo = new Map<string, DigestItem[]>();
      for (const i of list) byRepo.set(i.repo, [...(byRepo.get(i.repo) ?? []), i]);
      const shown: DigestItem[] = [];
      const earlier: FyiGroup["earlier"] = [];
      for (const [repo, repoItems] of [...byRepo.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const { shown: top, earlier: rest } = capPerRepo(repoItems, DISPLAY_CAP_PER_REPO);
        shown.push(...top);
        if (rest.length) earlier.push({ repo, tags: rest.flatMap((i) => [i.tag, ...i.alsoIn]) });
      }
      return { category, coverage: coverageMap.get(category) ?? { reposChecked: 0, releases: 0 }, items: shown, earlier };
    });

  const advisories: AdvisoryNotice[] = input.advisoryOnly.map(({ repo, advisory }) => ({
    repo: repo.fullName,
    category: repo.category,
    ghsaId: advisory.ghsaId,
    cveId: advisory.cveId,
    summary: advisory.summary,
    url: advisory.htmlUrl,
    severity: advisory.severity,
  }));

  const couldNotCheck = input.repoOutcomes
    .filter((o) => o.status !== "ok")
    .map((o) => ({ repo: o.repo.fullName, reason: o.error ? `${STATUS_REASON[o.status] ?? "Check failed."} ${o.error}`.trim() : STATUS_REASON[o.status] ?? "Check failed." }));
  const quiet = input.repoOutcomes
    .filter((o) => o.status === "ok" && o.releaseCount === 0)
    .map((o) => o.repo.fullName)
    .sort();

  const counts = {
    act: act.length + advisories.length,
    review: review.length,
    fyi: fyiItems.length,
    updated: updated.length,
    couldNotCheck: couldNotCheck.length,
    reposChecked: input.repoOutcomes.length,
    releasesFound: input.releases.length,
    aiFallbacks: input.aiFallbacks,
  };

  const notices: string[] = [];
  if (input.aiUnavailable) notices.push("The AI summarizer was unavailable for part of this run; affected items show the first lines of their release notes instead.");
  else if (input.aiFallbacks > 0) notices.push(`${plural(input.aiFallbacks, "summary", "summaries")} fell back to the first lines of the release notes because the AI output could not be validated.`);

  const base = input.baseUrl.replace(/\/$/, "");
  const partial = { act, review, advisories, counts };
  const synthesis = input.synthesis
    ? { paragraph: input.synthesis.paragraph, actions: input.synthesis.actions, source: "ai" as const }
    : deterministicSynthesis(partial);

  return {
    version: 1,
    isoWeek: input.isoWeek,
    weekOf: input.weekOf.toISOString(),
    window: { start: input.window.start.toISOString(), end: input.window.end.toISOString() },
    generatedAt: input.generatedAt.toISOString(),
    timezoneLabel: input.timezoneLabel,
    counts,
    statusLine: statusLine(counts),
    subject: digestSubject(counts.act, counts.review, input.weekOf),
    synthesis,
    act,
    advisories,
    review,
    updated,
    fyi,
    alreadyReported,
    couldNotCheck,
    quiet,
    coverage,
    notices,
    links: { digest: `${base}/digest/${input.isoWeek}`, archive: `${base}/archive`, admin: `${base}/admin` },
  };
}
