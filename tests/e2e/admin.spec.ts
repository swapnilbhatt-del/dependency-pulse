import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, expectNoSeriousA11yViolations, login } from "./helpers";

test.describe("admin", () => {
  test.skip(!ADMIN_PASSWORD, "Set E2E_ADMIN_PASSWORD (or ADMIN_PASSWORD) to run admin tests");
  test.describe.configure({ mode: "serial" });

  test("redirects to login without a session", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expectNoSeriousA11yViolations(page);
  });

  test("wrong password shows an inline error", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Admin password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText(/not correct|Too many attempts/);
  });

  test("login, add a repo, toggle it, remove it", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { level: 1, name: "Tracked repositories" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Invalid input is rejected before any API call.
    await page.getByLabel("Repository", { exact: true }).fill("not a repo");
    await page.getByRole("button", { name: "Add repository" }).click();
    await expect(page.locator("#add-input-error")).toContainText("owner/name");

    // Add a real public repo (verified on GitHub).
    const repo = "sindresorhus/is-plain-obj";
    await page.getByLabel("Repository", { exact: true }).fill(`https://github.com/${repo}.git`);
    await page.getByRole("button", { name: "Add repository" }).click();
    const row = page.locator(`[data-testid="repo-row"][data-repo="${repo}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });

    // Toggle enable/disable (optimistic).
    const toggle = row.getByTestId("enable-toggle");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("toast-success").last()).toContainText("disabled");
    await page.reload();
    await expect(page.locator(`[data-testid="repo-row"][data-repo="${repo}"]`).getByTestId("enable-toggle")).toHaveAttribute("aria-checked", "false");

    // Remove with confirmation.
    await page.locator(`[data-testid="repo-row"][data-repo="${repo}"]`).getByRole("button", { name: `Remove ${repo}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove repository" }).click();
    await expect(page.locator(`[data-testid="repo-row"][data-repo="${repo}"]`)).toHaveCount(0);
  });

  test("bulk import shows per-line validation before commit", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Bulk import" }).click();
    await page.getByLabel("Repositories").fill("stripe/stripe-node\nnot valid\n# comment");
    await expect(page.getByTestId("bulk-preview")).toContainText("Invalid");
    await expect(page.locator("#bulk-live")).toContainText("1 of 2 lines look valid");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  });

  test("runs and recipients pages are accessible", async ({ page }) => {
    await login(page);
    await page.goto("/admin/runs");
    await expect(page.getByRole("heading", { level: 1, name: "Runs" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.goto("/admin/recipients");
    await expect(page.getByRole("heading", { level: 1, name: "Recipients" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
