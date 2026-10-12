import { stripInjection } from "@/lib/signals/keywords";

function normalize(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links/images → their text
    .replace(/<[^>]+>/g, "") // inline HTML tags
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip wrapping quotes or ellipses a model might add around a quoted phrase. */
function unwrap(s: string): string {
  return s
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^(?:\.\.\.|…)\s*|\s*(?:\.\.\.|…)$/g, "")
    .trim();
}

/**
 * The model's evidence must be a verbatim (case-insensitive, whitespace- and
 * markdown-insensitive) substring of the release title or body. Text that
 * looks like prompt injection is removed first, so it can never serve as
 * evidence. Evidence shorter than 4 characters is rejected as meaningless.
 */
export function verifyEvidence(evidence: string | null | undefined, title: string, body: string): boolean {
  if (!evidence) return false;
  const needle = normalize(unwrap(evidence));
  if (needle.length < 4) return false;
  const haystack = normalize(`${stripInjection(title)}\n${stripInjection(body)}`);
  return haystack.includes(needle);
}

/**
 * The full source line containing the evidence, as plain text, so a reader can
 * judge the flag without opening the notes. Falls back to the phrase itself.
 */
export function evidenceInContext(evidence: string, title: string, body: string, max = 200): string {
  const needle = normalize(unwrap(evidence));
  for (const raw of [title, ...body.split("\n")]) {
    if (!normalize(raw).includes(needle)) continue;
    const plain = raw
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/^\s{0,3}#{1,6}\s*/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/[`*_]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (plain) return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
  }
  return displayEvidence(evidence, max);
}

/** A short excerpt for display: the evidence phrase as it appears in the source, max `max` chars. */
export function displayEvidence(evidence: string, max = 160): string {
  const t = unwrap(evidence).replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
