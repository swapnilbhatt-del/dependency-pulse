import { IconAlert, IconBreak, IconExternal, IconInfo, IconReview, IconShield } from "@/components/icons";
import type { AdvisoryNotice, DigestItem } from "@/lib/digest/model";
import { fmtShortDate } from "@/lib/digest/format";
import { safeGithubUrl } from "@/lib/util";

type Tone = "act" | "review" | "updated";

const TONE_CARD: Record<Tone, string> = { act: "card-act", review: "card-review", updated: "card-updated" };
const TONE_EVIDENCE: Record<Tone, string> = { act: "evidence-act", review: "evidence-review", updated: "" };

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

function Evidence({ item, tone }: { item: DigestItem; tone: Tone }) {
  const ev = item.evidence.filter((e) => e.kind !== "semver");
  if (!ev.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {ev.slice(0, 3).map((e, i) => {
        const url = e.url ? safeGithubUrl(e.url) : null;
        return (
          <blockquote key={i} className={`evidence ${TONE_EVIDENCE[tone]}`}>
            <span className="sr-only">{e.kind === "advisory" ? "GitHub advisory: " : "Quoted from the release notes: "}</span>
            {e.kind === "advisory" ? (
              url ? (
                <a href={url} rel="noopener noreferrer" target="_blank">
                  {e.text}
                </a>
              ) : (
                e.text
              )
            ) : (
              <>“{e.text}”</>
            )}
          </blockquote>
        );
      })}
    </div>
  );
}

/** "Flagged because the notes say …" → "The notes say …" (the label already says why). */
function explain(why: string): string {
  const t = why.replace(/^Flagged (?:for review )?because /, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function ReleaseCard({ item, tone, tz, headingLevel = 3 }: { item: DigestItem; tone: Tone; tz: string; headingLevel?: 3 | 4 }) {
  const H = `h${headingLevel}` as "h3" | "h4";
  const url = safeGithubUrl(item.url);
  const id = `item-${item.id.replace(/[^a-z0-9]/gi, "-")}`;
  const compact = tone !== "act";
  return (
    <article className={`card ${TONE_CARD[tone]} ${compact ? "p-4" : "p-4 sm:p-5"} print-avoid-break`} aria-labelledby={id} data-testid="release-card" data-tier={item.tier}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <H id={id} className="text-[1.0625rem] leading-snug font-semibold text-ink">
          {item.repo} <span className="font-mono text-[0.95em] font-medium">{item.tag}</span>
        </H>
        <time dateTime={item.publishedAt} className="tabular text-sm text-ink-3">
          {fmtShortDate(item.publishedAt, tz)}
        </time>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <TierChip tone={tone} item={item} />
        <span className="chip">{item.category}</span>
        <FlagChips item={item} />
      </div>
      <Evidence item={item} tone={tone} />
      <p className="mt-3 text-ink measure">{item.summary}</p>
      {item.whyFlagged && (
        <p className="mt-1.5 text-sm text-ink-2 measure">
          <span className="font-semibold text-ink">Why flagged: </span>
          {explain(item.whyFlagged)}
        </p>
      )}
      <details className="mt-1">
        <summary className="disclosure-summary">Details and next step</summary>
        <div className="disclosure-body pb-1">
          {item.keyChanges.length > 0 ? (
            <>
              <p className="eyebrow mt-1">Key changes</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-2 space-y-1 measure">
                {item.keyChanges.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-ink-3">{item.flags.noNotes ? "No release notes published." : "The notes list no further concrete changes."}</p>
          )}
          {item.nextStep && (
            <p className="mt-3 text-sm measure">
              <span className="font-semibold">Suggested next step: </span>
              {item.nextStep}
            </p>
          )}
          {item.alsoIn.length > 0 && <p className="mt-2 text-sm text-ink-3">Also in {item.alsoIn.join(", ")}</p>}
          {item.flags.injection && <p className="mt-2 text-sm text-ink-3">These notes contained instruction-like text. It was ignored and flags were checked deterministically.</p>}
          <p className="mt-2 text-xs text-ink-3">
            Area: {item.affectedArea} · Confidence: {item.confidence} · Summary: {item.aiStatus === "ok" ? "Gemini Flash, checked against the notes" : item.aiStatus === "fallback" ? "first lines of the notes (AI fallback)" : "first lines of the notes"}
          </p>
          {url && (
            <p className="mt-2">
              <a href={url} rel="noopener noreferrer" target="_blank" className="inline-flex items-center gap-1 min-h-11 text-sm font-semibold">
                Read the {item.flags.tagOnly ? "tag" : "release notes"} on GitHub <IconExternal />
                <span className="sr-only"> for {item.repo} {item.tag} (opens in a new tab)</span>
              </a>
            </p>
          )}
        </div>
      </details>
    </article>
  );
}

export function AdvisoryCard({ a }: { a: AdvisoryNotice }) {
  const url = safeGithubUrl(a.url);
  const id = `adv-${a.ghsaId}`;
  return (
    <article className="card card-act p-4 sm:p-5 print-avoid-break" aria-labelledby={id} data-testid="advisory-card">
      <h3 id={id} className="text-[1.0625rem] font-semibold">
        {a.repo} <span className="font-normal text-ink-2">security advisory</span>
      </h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <TierChip tone="act" />
        <span className="chip chip-act">
          <IconShield size={12} /> Security advisory
        </span>
        {a.severity && <span className="chip">Severity: {a.severity}</span>}
        <span className="chip">{a.category}</span>
      </div>
      <blockquote className="evidence evidence-act mt-3">
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
      <p className="mt-3 measure">{a.summary}</p>
      <p className="mt-1.5 text-sm text-ink-2 measure">
        <span className="font-semibold text-ink">Why flagged: </span>Published this week, and no release in the window matched its patched version. Check the advisory for affected versions.
      </p>
    </article>
  );
}
