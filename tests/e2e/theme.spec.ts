import { expect, test } from "@playwright/test";
import { onboard } from "./helpers";

test("settings: theme switch sets data-theme and survives a reload", async ({ page }) => {
  await onboard(page);
  await page.getByRole("link", { name: "Settings" }).click();
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme", /.*/);
  const theme = page.getByTestId("theme-setting");

  await theme.getByRole("button", { name: "Dark" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(theme.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");

  await theme.getByRole("button", { name: "Light" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");

  await theme.getByRole("button", { name: "System" }).click();
  await expect(html).not.toHaveAttribute("data-theme", /.*/);
});
