import type { ReleaseAnalysis } from "@/lib/ai/schema";
import { stripInjection } from "@/lib/signals/keywords";
import { clampText } from "@/lib/util";

export const NO_NOTES_SUMMARY = "No release notes published.";

const HEADING_NOISE = /^(what'?s changed|changes|changelog|release notes|summary|highlights|features|bug fixes|fixes|other changes|misc|chores?|dependencies|new contributors)\s*:?$/i;

function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic summary used when the model is unavailable or its output fails
 * validation twice: the first meaningful line of the notes, plus the first
 * bullet points as key changes. Never invents content.
 */
export function fallbackAnalysis(body: string): ReleaseAnalysis {
  const lines = stripInjection(body)
    .split("\n")
    .map((raw) => ({ raw, text: plainLine(raw) }))
    .filter((l) => l.text.length > 2 && !HEADING_NOISE.test(l.text) && !/^https?:\/\/\S+$/.test(l.text));
  const first = lines[0]?.text;
  const bullets = lines
    .filter((l) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l.raw))
    .slice(0, 4)
    .map((l) => clampText(l.text, 140));
  return {
    one_line_summary: first ? clampText(first, 160) : NO_NOTES_SUMMARY,
    key_changes: bullets,
    change_type: "unknown",
    is_security_fix: false,
    is_breaking_change: false,
    security_evidence: null,
    breaking_evidence: null,
    affected_area: "not stated",
    requires_action: "none",
    confidence: "low",
  };
}
