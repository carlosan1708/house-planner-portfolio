import { expect, test } from "@playwright/test";

test("visitor landing renders the public entry point", async ({ page }) => {
  await page.goto("/?lang=en");
  await expect(page).toHaveTitle(/House Planner/);
  await expect(page.locator("body")).toContainText("House Planner");
  await expect(page.getByRole("button", { name: /demo/i }).first()).toBeVisible();
});

test("synthetic demo opens its dashboard", async ({ page }) => {
  await page.goto("/?mode=demo&lang=en");
  await expect(page.getByText("Demo with fictional data")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explore House Planner" })).toBeVisible();
});

test("demo budget exposes its editable synthetic rows", async ({ page }) => {
  await page.goto("/?mode=demo&lang=en");
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("button", { name: /Budget/ }).click();
  await expect(page.getByRole("heading", { name: "Budget dashboard" })).toBeVisible();
  await page.getByRole("button", { name: "Edit budget", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Concrete and reinforcement Paid", exact: true })).toBeVisible();
});
