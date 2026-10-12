import { IconAlert, IconArrowRight, IconBreak, IconExternal, IconInfo, IconReview, IconShield } from "@/components/icons";
import type { AdvisoryNotice, DigestItem } from "@/lib/digest/model";
import { fmtShortDate } from "@/lib/digest/format";
import { safeGithubUrl } from "@/lib/util";

type Tone = "act" | "review" | "updated";

const HEAD: Record<Tone, string> = { act: "card-head-act", review: "card-head-review", updated: "card-head-neutral" };
const QUOTE_MARK: Record<Tone, string> = { act: "var(--act)", review: "var(--review)", updated: "var(--ink-3)" };

const MONO_COLORS = ["#0f766e", "#1d4ed8", "#7c3aed", "#b45309", "#be123c", "#0369a1", "#4d7c0f", "#374151"];

/** A stable coloured initial for a repository owner, so lists are scannable without loading avatars. */
export function Monogram({ repo }: { repo: string }) {
  let h = 0;
  for (const ch of repo.split("/")[0]) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="monogram" style={{ background: MONO_COLORS[h % MONO_COLORS.length] }} aria-hidden="true">
      {repo.split("/")[0].slice(0, 2)}
    </span>
  );
}

export function TierChip({ tone, item }: { tone: Tone; item?: DigestItem }) {
  if (tone === "act")
    return (
      <span className="chip chip-act">
        <IconAlert size={13} /> Act now
      </span>
    );
  if (tone === "review")
    return (
      <span className="chip chip-review">
        <IconReview size={13} /> Review
      </span>
    );
  return (
    <span className="chip">
      <IconInfo size={13} /> {item?.tier === 1 ? "Act now" : item?.tier === 2 ? "Review" : "FYI"}
    </span>
  );
}

export function FlagChips({ item }: { item: DigestItem }) {
  const f = item.flags;
  return (
    <>
      {f.security && (
        <span className="chip chip-act">
          <IconShield size={12} /> Security fix
        </span>
      )}
      {f.breaking && (
        <span className="chip chip-review">
          <IconBreak size={12} /> Breaking change
        </span>
      )}
      {f.majorBump && <span className="chip chip-review">Major version bump</span>}
      {f.updated && <span className="chip">Updated since last digest</span>}
      {f.prerelease && <span className="chip">Pre-release</span>}
      {f.tagOnly && <span className="chip">Tag (no GitHub Release)</span>}
      {f.lowConfidence && <span className="chip chip-review">Low confidence, verify before acting</span>}
    </>
  );
}

/** "Flagged because the notes say …" → "The notes say …" (the label already says why). */
function explain(why: string): string {
  const t = why.replace(/^Flagged (?:for review )?because /, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function ReleaseCard({ item, tone, tz }: { item: DigestItem; tone: Tone; tz: string }) {
  const url = safeGithubUrl(item.url);
  const id = `item-${item.id.replace(/[^a-z0-9]/gi, "-")}`;
  const evidence = item.evidence.filter((e) => e.kind !== "semver").slice(0, 2);
  return (
    <article className="card lift overflow-hidden print-avoid-break" aria-labelledby={id} data-testid="release-card" data-tier={item.tier}>
      <div className={`flex flex-wrap items-center gap-1.5 px-4 sm:px-5 py-2.5 ${HEAD[tone]}`}>
        <TierChip tone={tone} item={item} />
        <FlagChips item={item} />
        <time dateTime={item.publishedAt} className="ml-auto tabular text-xs font-medium text-ink-3">
          {fmtShortDate(item.publishedAt, tz)}
        </time>
      </div>
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Monogram repo={item.repo} />
          <div className="min-w-0 flex-1">
            <h3 id={id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[1.0625rem] leading-snug font-semibold text-ink">
              <span className="break-all">{item.repo}</span>
              <span className="version-pill">{item.tag}</span>
            </h3>
            <p className="mt-0.5 text-xs text-ink-3">
              <span className="capitalize">{item.category}</span> · {item.priority} priority
            </p>
          </div>
        </div>

        <p className="mt-3 text-ink measure leading-relaxed">{item.summary}</p>

        {evidence.length > 0 && (
          <figure className="mt-3 space-y-2">
            {evidence.map((e, i) => {
              const eu = e.url ? safeGithubUrl(e.url) : null;
              return (
                <blockquote key={i} className="pull-quote" style={{ ["--quote-mark" as string]: QUOTE_MARK[tone] }}>
                  <span className="sr-only">{e.kind === "advisory" ? "GitHub advisory: " : "Quoted from the release notes: "}</span>
                  {e.kind === "advisory" && eu ? (
                    <a href={eu} rel="noopener noreferrer" target="_blank">
                      {e.text}
                    </a>
                  ) : (
                    e.text
                  )}
                </blockquote>
              );
            })}
            <figcaption className="text-xs text-ink-3">{evidence.some((e) => e.kind === "advisory") ? "From GitHub's advisory database and the release notes" : "From the release notes, verbatim"}</figcaption>
          </figure>
        )}

        {item.whyFlagged && (
          <p className="mt-3 text-sm text-ink-2 measure">
            <span className="font-semibold text-ink">Why flagged: </span>
            {explain(item.whyFlagged)}
          </p>
        )}
        {item.nextStep && (
          <p className="callout mt-3">
            <IconArrowRight className="mt-0.5 shrink-0 text-brand" size={16} />
            <span>
              <span className="font-semibold">Next step: </span>
              {item.nextStep}
            </span>
          </p>
        )}

        {item.related && item.related.length > 0 && (
          <div className="mt-4 rounded-xl border border-line">
            <p className="border-b border-line px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
              {item.related.length} more flagged {item.related.length === 1 ? "release" : "releases"} of {item.repo} this week
            </p>
            <ul className="divide-y divide-line">
              {item.related.map((r) => {
                const ru = safeGithubUrl(r.url);
                return (
                  <li key={r.tag} className="px-3.5 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="version-pill">{r.tag}</span>
                      {r.prerelease && <span className="chip">Pre-release</span>}
                      <time dateTime={r.publishedAt} className="tabular text-xs text-ink-3">
                        {fmtShortDate(r.publishedAt, tz)}
                      </time>
                      {ru && (
                        <a href={ru} rel="noopener noreferrer" target="_blank" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold">
                          Notes <IconExternal size={11} />
                          <span className="sr-only"> for {item.repo} {r.tag} (opens in a new tab)</span>
                        </a>
                      )}
                    </div>
                    <p className="mt-1 text-ink-2">{r.summary}</p>
                    {r.whyFlagged && <p className="mt-0.5 text-xs text-ink-3">{explain(r.whyFlagged)}</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <details className="mt-2">
          <summary className="disclosure-summary">Key changes{item.keyChanges.length ? ` (${item.keyChanges.length})` : ""} and source</summary>
          <div className="disclosure-body pb-1">
            {item.keyChanges.length > 0 ? (
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-2 space-y-1 measure">
                {item.keyChanges.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">{item.flags.noNotes ? "No release notes published." : "The notes list no further concrete changes."}</p>
            )}
            {item.alsoIn.length > 0 && <p className="mt-2 text-sm text-ink-3">Also in {item.alsoIn.join(", ")}</p>}
            {item.flags.injection && <p className="mt-2 text-sm text-ink-3">These notes contained instruction-like text. It was ignored and flags were checked deterministically.</p>}
            <p className="mt-2 text-xs text-ink-3">
              Area: {item.affectedArea} · Confidence: {item.confidence} · Summary:{" "}
              {item.aiStatus === "ok" ? "Gemini Flash, checked against the notes" : item.aiStatus === "fallback" ? "first lines of the notes (AI fallback)" : "first lines of the notes"}
            </p>
            {url && (
              <p className="mt-1">
                <a href={url} rel="noopener noreferrer" target="_blank" className="inline-flex items-center gap-1 min-h-11 text-sm font-semibold">
                  Read the {item.flags.tagOnly ? "tag" : "release notes"} on GitHub <IconExternal />
                  <span className="sr-only"> for {item.repo} {item.tag} (opens in a new tab)</span>
                </a>
              </p>
            )}
          </div>
        </details>
      </div>
    </article>
  );
}

export function AdvisoryCard({ a }: { a: AdvisoryNotice }) {
  const url = safeGithubUrl(a.url);
  const id = `adv-${a.ghsaId}`;
  return (
    <article className="card lift overflow-hidden print-avoid-break" aria-labelledby={id} data-testid="advisory-card">
      <div className="flex flex-wrap items-center gap-1.5 px-4 sm:px-5 py-2.5 card-head-act">
        <TierChip tone="act" />
        <span className="chip chip-act">
          <IconShield size={12} /> Security advisory
        </span>
        {a.severity && <span className="chip">Severity: {a.severity}</span>}
      </div>
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Monogram repo={a.repo} />
          <h3 id={id} className="text-[1.0625rem] font-semibold">
            {a.repo} <span className="font-normal text-ink-2">security advisory</span>
          </h3>
        </div>
        <p className="mt-3 measure">{a.summary}</p>
        <blockquote className="pull-quote mt-3" style={{ ["--quote-mark" as string]: "var(--act)" }}>
          <span className="sr-only">GitHub advisory: </span>
          {url ? (
            <a href={url} rel="noopener noreferrer" target="_blank">
              {a.ghsaId}
              {a.cveId ? ` (${a.cveId})` : ""}
            </a>
          ) : (
            a.ghsaId
          )}
        </blockquote>
        <p className="mt-3 text-sm text-ink-2 measure">
          <span className="font-semibold text-ink">Why flagged: </span>Published this week, and no release in the window matched its patched version. Check the advisory for affected versions.
        </p>
      </div>
    </article>
  );
}
