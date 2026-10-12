import { DIMENSION_LABEL } from "@/lib/health/labels";
import { DIMENSION_ORDER, dimensionBand, headline } from "@/lib/health/present";
import type { ReportView } from "@/lib/health/queries";
import { VERDICT_LABEL } from "@/lib/health/types";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Comparison as a GitHub/Slack-friendly Markdown table. */
export function compareMarkdown(reports: ReportView[], baseUrl: string): string {
  const head = `| | ${reports.map((r) => `[${cell(r.fullName)}](${baseUrl}/evaluate/${r.slug})`).join(" | ")} |`;
  const sep = `|---|${reports.map(() => "---").join("|")}|`;
  const rows = [
    `| **Verdict** | ${reports.map((r) => (r.verdict ? VERDICT_LABEL[r.verdict] : "Not checked")).join(" | ")} |`,
    `| **Score** | ${reports.map((r) => `${r.score ?? "—"} (${Math.round((r.coverage ?? 0) * 100)}% weight covered)`).join(" | ")} |`,
    ...DIMENSION_ORDER.map((d) => `| ${DIMENSION_LABEL[d]} | ${reports.map((r) => `${dimensionBand(r.dimensions[d])}${r.dimensions[d].score !== null ? ` ${r.dimensions[d].score}` : ""} · ${cell(r.metrics ? headline(d, r.metrics) : "—")}`).join(" | ")} |`),
    `| Top concern | ${reports.map((r) => cell(r.reasons.find((x) => x.tag === "concern")?.text ?? "None")).join(" | ")} |`,
  ];
  return [`**Adoption Check comparison** (${new Date().toISOString().slice(0, 10)})`, "", head, sep, ...rows, "", "Responsiveness is sampled; stars are a weak signal. Method: docs/HEALTH_METHOD.md"].join("\n");
}
