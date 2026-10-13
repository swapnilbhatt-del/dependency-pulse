import "dotenv/config";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { ADMIN_PASSWORD, expectNoSeriousA11yViolations, login } from "../e2e/helpers";

const TEST_REPO = "sindresorhus/is-plain-obj";
const TEST_SLUG = "sindresorhus--is-plain-obj";

/** Remove the candidate (snapshots and decisions cascade) and any repo row the workflow test created. */
async function removeTestRows() {
  if (!process.env.DATABASE_URL) return;
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const [owner, name] = TEST_REPO.split("/");
  await sql`delete from evaluation_candidates where owner = ${owner} and name = ${name}`;
  await sql`delete from repos where full_name = ${TEST_REPO} and last_checked_at is null`;
  await sql.end();
}
test.beforeAll(removeTestRows);
test.afterAll(removeTestRows);

test.describe("Adoption Check: public pages", () => {
  test("watchlist renders verdict chips with text labels and is axe clean", async ({ page }) => {
    await page.goto("/evaluate");
    await expect(page.getByRole("heading", { level: 1, name: "Before you adopt it" })).toBeVisible();
    const cards = page.getByTestId("candidate-card");
    test.skip((await cards.count()) === 0, "No candidates yet");
    await expect(cards.first().locator("[data-verdict]")).toHaveText(/Healthy|Watch|Risky|Insufficient data/);
    await expectNoSeriousA11yViolations(page);
  });

  test("report shows the required sections and is axe clean", async ({ page }) => {
    await page.goto("/evaluate");
    const first = page.getByTestId("candidate-card").first().getByRole("link").first();
    test.skip((await first.count()) === 0, "No candidates yet");
    await first.click();
    for (const h of ["Decision in one minute", "Why this verdict", "Nine dimensions", "Trend", "Decision log"]) await expect(page.getByRole("heading", { name: h })).toBeVisible();
    await expect(page.getByText("What this does not tell you:")).toBeVisible();
    await expect(page.getByTestId("dimension-card")).toHaveCount(9);
    await page.getByTestId("dimension-card").first().getByText("Source values").click();
    await expectNoSeriousA11yViolations(page);
  });

  test("compare renders and scrolls inside its container at 360px; axe clean", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/evaluate");
    const slugs = await page.getByTestId("candidate-card").evaluateAll((els) => els.map((e) => (e.querySelector("a[href^='/evaluate/']") as HTMLAnchorElement).getAttribute("href")!.split("/").pop()!)).then((all) => all.filter((s) => s !== TEST_SLUG));
    test.skip(slugs.length < 2, "Need at least two candidates");
    await page.goto(`/evaluate/compare?ids=${slugs.slice(0, 4).join(",")}`);
    const table = page.getByTestId("compare-table");
    await expect(table.locator("thead th")).toHaveCount(Math.min(4, slugs.length) + 1);
    const box = page.getByTestId("compare-scroll");
    await expect(box).toBeVisible();
    const dims = await box.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, vw: window.innerWidth }));
    expect(dims.sw, JSON.stringify(dims)).toBeGreaterThan(dims.cw);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await box.evaluate((el) => el.scrollTo({ left: 400 }));
    await expect(table.locator("tbody th").first()).toBeInViewport();
    await expect(page.getByTestId("copy-markdown")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe("Adoption Check: admin workflow", () => {
  test.skip(!ADMIN_PASSWORD, "Set E2E_ADMIN_PASSWORD to run admin tests");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  test("add a candidate, see it on the watchlist, open its report, record a decision, see it in the log", async ({ page }) => {
    await login(page);
    await page.goto("/admin/evaluate");
    await expectNoSeriousA11yViolations(page);

    // Inline validation before any API call.
    await page.getByLabel("GitHub repository").fill("not a repo");
    await page.getByRole("button", { name: "Add candidate" }).click();
    await expect(page.locator("#cand-input-err")).toContainText("owner/name");

    const existing = page.locator(`[data-testid="admin-candidate"][data-candidate="${TEST_REPO}"]`);
    if ((await existing.count()) === 0) {
      await page.getByLabel("GitHub repository").fill(`https://github.com/${TEST_REPO}`);
      await page.getByLabel("Registry").first().selectOption("npm");
      await page.getByLabel("Package name").first().fill("is-plain-obj");
      await page.getByLabel("Intended use (optional)").fill("E2E test candidate");
      await page.getByRole("button", { name: "Add candidate" }).click();
      await expect(existing).toBeVisible({ timeout: 90_000 });
    }
    await expect(existing.locator("[data-verdict]")).toBeVisible();

    await page.goto("/evaluate");
    await expect(page.getByRole("link", { name: TEST_REPO })).toBeVisible();
    await page.getByRole("link", { name: TEST_REPO }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluate/${TEST_SLUG}$`));

    await page.goto("/admin/evaluate");
    await existing.getByRole("button", { name: "Record decision" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Parked").check();
    await dialog.getByRole("button", { name: "Record decision" }).click();
    await expect(dialog.locator("#d-reason-err")).toContainText("reason");
    await dialog.getByLabel("Reason (required)").fill("E2E: parked until the next major release.");
    await dialog.getByLabel("Decided by").fill("E2E test");
    await dialog.getByRole("button", { name: "Record decision" }).click();
    await expect(page.getByTestId("toast-success").last()).toContainText("Decision recorded");

    await page.goto(`/evaluate/${TEST_SLUG}`);
    const log = page.getByTestId("decision-log");
    await expect(log).toContainText("Parked");
    await expect(log).not.toContainText("E2E: parked until"); // reasons stay private by default
  });

  test("the email flag switch shows the stored setting (off unless an admin turned it on)", async ({ page }) => {
    let stored = false;
    if (process.env.DATABASE_URL) {
      const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
      const [row] = await sql`select value_json from app_settings where key = 'email_watchlist_enabled'`;
      stored = row?.value_json === true;
      await sql.end();
    }
    await login(page);
    await page.goto("/admin/evaluate");
    await expect(page.getByTestId("email-flag")).toHaveAttribute("aria-checked", String(stored));
  });
});
