import { expect, test } from "@playwright/test";
import { onboard } from "./helpers";

test("first visit goes through onboarding and lands on today's lesson", async ({ page }) => {
  await onboard(page);
  await expect(page.getByTestId("streak")).toContainText("0");
  await expect(page.getByTestId("demo-notice")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start lesson" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Free talk/ })).toBeVisible();
});

test("can't continue onboarding without choosing a goal", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("settings: change goal and download a calendar reminder", async ({ page }) => {
  await onboard(page);
  await page.getByRole("link", { name: "Settings" }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("add-reminder").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("accent-practice.ics");
  const body = await (await file.createReadStream()).toArray();
  expect(Buffer.concat(body).toString()).toContain("RRULE:FREQ=DAILY");

  await page.getByRole("button", { name: /Travel/ }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.getByRole("link", { name: "Today" }).click();
  await expect(page.getByText("Travel practice")).toBeVisible();
});
