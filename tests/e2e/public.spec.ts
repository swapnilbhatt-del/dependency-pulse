import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./helpers";

test.describe("public pages", () => {
  test("home renders with one h1 and no serious a11y issues", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);
    await expectNoSeriousA11yViolations(page);
  });

  test("archive renders and links to digests", async ({ page }) => {
    await page.goto("/archive");
    await expect(page.getByRole("heading", { level: 1, name: "Past digests" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("digest page: tiers in order, theme switch, print layout", async ({ page }) => {
    await page.goto("/archive");
    const first = page.locator('[data-testid="archive-list"] a').first();
    test.skip((await first.count()) === 0, "No digest published yet");
    await first.click();
    await expect(page.getByTestId("summary-bar")).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);

    // Act now comes before Review, which comes before FYI.
    const order = await page.locator("h2").allTextContents();
    const idx = (t: string) => order.findIndex((x) => x.trim() === t);
    if (idx("Act now") >= 0 && idx("Review") >= 0) expect(idx("Act now")).toBeLessThan(idx("Review"));
    if (idx("Review") >= 0 && idx("FYI") >= 0) expect(idx("Review")).toBeLessThan(idx("FYI"));
    await expectNoSeriousA11yViolations(page);

    // Theme toggle: system → light → dark, persisted.
    const toggle = page.getByTestId("theme-toggle");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(17, 19, 22)");
    await expectNoSeriousA11yViolations(page);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Print: light colours, no nav or buttons.
    await page.emulateMedia({ media: "print" });
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
    await expect(page.getByTestId("print-button")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    await page.emulateMedia({ media: "screen" });
  });

  test("unknown digest week returns 404 page", async ({ page }) => {
    const res = await page.goto("/digest/1999-W01");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "That page does not exist" })).toBeVisible();
  });

  test("no horizontal scroll at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of ["/", "/archive", "/admin/login"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("security headers are set", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["x-frame-options"]).toBe("DENY");
  });

  test("cron endpoint rejects requests without the secret", async ({ request }) => {
    expect((await request.get("/api/cron/weekly-digest")).status()).toBe(401);
    expect((await request.get("/api/cron/weekly-digest", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  });

  test("health endpoint exposes no secret values", async ({ request }) => {
    const res = await request.get("/api/health");
    const body = await res.text();
    expect(body).not.toMatch(/postgres(ql)?:\/\/|github_pat_|ghp_|AIza|re_[A-Za-z0-9]{8}/);
    expect(JSON.parse(body)).toHaveProperty("config.present");
  });
});
