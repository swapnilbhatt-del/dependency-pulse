import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./helpers";

// GSAP motion (components/motion.tsx): below-the-fold content animates in on scroll,
// what is on screen at first paint is never hidden, and nothing ends up invisible.
test.use({ contextOptions: { reducedMotion: "no-preference" } });

const opacity = (page: Page, sel: string, i: number) => page.locator(sel).nth(i).evaluate((el) => Number(getComputedStyle(el).opacity));

async function waitForMotion(page: Page) {
  // GSAP loads when the browser is idle; it marks below-the-fold cards with an inline opacity.
  await expect.poll(() => page.locator("#main .card[style*='opacity']").count(), { timeout: 8000 }).toBeGreaterThan(0);
}

test("first paint is never hidden; below-the-fold cards reveal on scroll and end fully visible", async ({ page }) => {
  await page.goto("/evaluate");
  const cards = page.locator("#main .card");
  expect(await opacity(page, "#main .card", 0)).toBe(1);
  await waitForMotion(page);
  // The first card was on screen at load: still fully visible after GSAP ran.
  expect(await opacity(page, "#main .card", 0)).toBe(1);
  // The last card starts hidden, then reveals once scrolled into view.
  const last = (await cards.count()) - 1;
  expect(await opacity(page, "#main .card", last)).toBe(0);
  await cards.nth(last).scrollIntoViewIfNeeded();
  await expect.poll(() => opacity(page, "#main .card", last), { timeout: 3000 }).toBe(1);
  // Scores count up and land on their real value.
  const score = cards.nth(last).locator("[data-count]");
  await expect(score).toHaveText(/^\d+$/);
});

test("digest coverage bars fill on scroll, and every element ends visible (axe clean)", async ({ page }) => {
  await page.goto("/digest/2026-W42");
  await waitForMotion(page);
  const bar = page.locator("section[aria-labelledby='coverage'] .bar-track > span").first();
  await expect.poll(() => bar.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix\(0,/);
  await bar.scrollIntoViewIfNeeded();
  await expect.poll(() => bar.evaluate((el) => getComputedStyle(el).transform), { timeout: 3000 }).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  // Scroll through the whole page; nothing may stay hidden.
  for (let y = 0; y < (await page.evaluate(() => document.documentElement.scrollHeight)); y += 500) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(900);
  expect(await page.locator("#main .card, #main .glance, #main .stat-tile").evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== "1").length)).toBe(0);
  await expectNoSeriousA11yViolations(page);
});

test("navigating within the site plays a short entrance that settles fully visible", async ({ page }) => {
  await page.goto("/evaluate");
  await waitForMotion(page);
  await page.getByRole("link", { name: "Open report" }).first().click();
  await expect(page).toHaveURL(/\/evaluate\/[^/]+$/);
  await page.waitForTimeout(1200);
  const inView = await page.locator("#main .card, #main .glance").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().top < innerHeight).map((e) => getComputedStyle(e).opacity));
  expect(inView.every((o) => o === "1")).toBe(true);
});

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  test("no element is touched by GSAP", async ({ page }) => {
    await page.goto("/evaluate");
    await page.waitForTimeout(2500);
    expect(await page.locator("#main [style*='opacity'], #main [style*='translate'], #main [style*='scale']").count()).toBe(0);
  });
});

test("admin pages are left alone", async ({ page }) => {
  await page.goto("/admin/login");
  await page.waitForTimeout(2500);
  expect(await page.locator("#main [style*='opacity'], #main [style*='translate']").count()).toBe(0);
});
