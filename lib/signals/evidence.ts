import { stripInjection } from "@/lib/signals/keywords";

function normalize(s: string): string {
  return s
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

/** A short excerpt for display: the evidence phrase as it appears in the source, max `max` chars. */
export function displayEvidence(evidence: string, max = 160): string {
  const t = unwrap(evidence).replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
