import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DigestView } from "@/components/digest/digest-view";
import { buildDigest } from "@/lib/digest/build";
import { renderEmailHtml } from "@/lib/digest/render-email";
import { renderEmailText } from "@/lib/digest/render-text";
import { safeGithubUrl } from "@/lib/util";
import { analysis, classified, release, repo } from "../fixtures/factory";

const EVIL = `<script>alert("x")</script><img src=x onerror=alert(1)> Fixes CVE-2026-1234`;

function model() {
  const rp = repo({ fullName: "evil/<b>repo</b>", category: "pay<i>ments" });
  const r = release({ body: EVIL, name: "<svg onload=alert(1)>", tagName: "v1.0.0" });
  const c = classified(r, analysis({ one_line_summary: `<script>alert(2)</script>`, key_changes: [`<a href="javascript:alert(3)">x</a>`] }), rp);
  return buildDigest({
    isoWeek: "2026-W42",
    weekOf: new Date("2026-10-12T00:00:00Z"),
    window: { start: new Date("2026-10-05T03:30:00Z"), end: new Date("2026-10-12T03:30:00Z") },
    generatedAt: new Date("2026-10-12T03:31:00Z"),
    timezoneLabel: "Asia/Kolkata",
    baseUrl: "https://pulse.example",
    releases: [c],
    repoOutcomes: [{ repo: rp, status: "ok", error: null, releaseCount: 1, usedTagFallback: false }],
    advisoryOnly: [],
    aiFallbacks: 0,
  });
}

describe("escaping", () => {
  it("email HTML renders release content as inert text", () => {
    const html = renderEmailHtml(model());
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/<a href="javascript:/);
    expect(html).not.toMatch(/<b>repo<\/b>/);
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
    expect(html).toContain("evil/&lt;b&gt;repo&lt;/b&gt;");
  });

  it("web digest renders release content as inert text", () => {
    const html = renderToStaticMarkup(createElement(DigestView, { d: model() }));
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/href="javascript:/);
    expect(html).not.toMatch(/<svg onload/);
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("plain text part contains no markup interpretation issues", () => {
    const t = renderEmailText(model());
    expect(t).toContain("DEPENDENCY PULSE, WEEK OF 12 OCT 2026");
    expect(t).toContain("== ACT NOW ==");
  });

  it("only github.com https links are rendered", () => {
    expect(safeGithubUrl("https://github.com/a/b/releases/tag/v1")).toBe("https://github.com/a/b/releases/tag/v1");
    expect(safeGithubUrl("javascript:alert(1)")).toBeNull();
    expect(safeGithubUrl("https://github.com.evil.com/a")).toBeNull();
    expect(safeGithubUrl("http://github.com/a")).toBeNull();
    expect(safeGithubUrl("https://evil.com/github.com")).toBeNull();
  });
});
