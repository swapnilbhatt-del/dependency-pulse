import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIGEST_CRON_EXPRESSION } from "@/lib/config";

/** WCAG relative luminance contrast. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

describe("schedule", () => {
  it("vercel.json cron matches DIGEST_SCHEDULE", () => {
    const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons).toContainEqual({ path: "/api/cron/weekly-digest", schedule: DIGEST_CRON_EXPRESSION });
    // Daily keep-alive so the free Supabase project is never paused for inactivity.
    expect(v.crons).toContainEqual({ path: "/api/health", schedule: "0 6 * * *" });
    // Adoption Check refresh: Monday 04:30 UTC, one hour after the digest (03:30), so they never overlap.
    expect(v.crons).toContainEqual({ path: "/api/cron/health-refresh", schedule: "30 4 * * 1" });
    expect(DIGEST_CRON_EXPRESSION).toBe("30 3 * * 1");
  });
});

describe("design token contrast (WCAG 2.2 AA, 4.5:1)", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(selector);
    const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  };
  const themes = { light: block(":root {"), dark: block(':root[data-theme="dark"]') };
  for (const [name, t] of Object.entries(themes)) {
    const pairs: [string, string][] = [
      ["ink", "bg"],
      ["ink-2", "bg"],
      ["ink-3", "bg"],
      ["ink-3", "surface"],
      ["ink-3", "surface-2"],
      ["accent", "bg"],
      ["accent", "surface"],
      ["act", "surface"],
      ["act", "act-bg"],
      ["review", "surface"],
      ["review", "review-bg"],
      ["ok", "surface"],
      ["accent-ink", "accent"],
    ];
    for (const [fg, bg] of pairs) {
      it(`${name}: --${fg} on --${bg}`, () => {
        expect(t[fg], `missing --${fg}`).toBeDefined();
        expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
