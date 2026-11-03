import { expect, test } from "@playwright/test";

test("home page loads and the theme switches", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Bid live/ })).toBeVisible();
  const html = page.locator("html");

  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.reload();
  await expect(html).toHaveClass(/dark/);

  // The header toggle cycles dark -> system -> light.
  const toggle = page.getByRole("button", { name: /^Theme: Dark/ }).first();
  await toggle.click();
  await page.getByRole("button", { name: /^Theme: System/ }).first().click();
  await expect(html).not.toHaveClass(/dark/);
});

test("privacy and support pages are reachable", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await page.getByRole("link", { name: "the support form" }).first().click();
  await expect(page.getByRole("heading", { name: "Contact support" })).toBeVisible();
});
