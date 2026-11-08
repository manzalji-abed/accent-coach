import { expect, test } from "@playwright/test";
import { onboard, speakTurn } from "./helpers";

test("live session failure shows a clear error and tapping the mic again reconnects", async ({ page }) => {
  await onboard(page);
  await page.route("**/api/live", (route) => route.fulfill({ status: 502, json: { error: "Couldn't start a live session with your coach. Try again in a minute." } }));
  await page.getByRole("link", { name: /Free talk/ }).click();
  await page.getByTestId("mic").click();
  await expect(page.getByTestId("dock-hint")).toHaveText(/Couldn.t start a live session/);
  await expect(page.getByTestId("mic")).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("user-bubble")).toHaveCount(0);

  await page.unroute("**/api/live");
  await speakTurn(page);
  await expect(page.getByTestId("user-bubble")).toHaveCount(1);
  await expect(page.getByTestId("dock-hint")).not.toHaveText(/Couldn.t/);
});

test("live conversation: pausing stops listening, tapping again carries on", async ({ page }) => {
  await onboard(page);
  await page.getByRole("link", { name: /Free talk/ }).click();
  const mic = page.getByTestId("mic");
  await expect(page.getByTestId("dock-hint")).toHaveText("Tap the mic to start talking with your coach");

  await mic.click();
  await expect(mic).toHaveAttribute("data-state", "recording");
  await expect(page.getByTestId("live-status")).toHaveText("Live");
  await expect(page.getByTestId("user-bubble")).toHaveCount(1);
  // The coach answers in the same conversation, without a send step.
  await expect(page.locator(".bubble.coach")).toHaveCount(2);

  await mic.click();
  await expect(mic).toHaveAttribute("data-state", "paused");
  await expect(page.getByTestId("live-status")).toHaveText("Paused");
  await expect(page.getByTestId("dock-hint")).toHaveText("Paused. Tap the mic to keep talking.");
  await page.waitForTimeout(4000); // longer than demo mode's gap between turns
  await expect(page.getByTestId("user-bubble")).toHaveCount(1); // nothing heard while paused

  await mic.click();
  await expect(mic).toHaveAttribute("data-state", "recording");
  await expect(page.getByTestId("user-bubble")).toHaveCount(2);
});

test("blocked microphone tells the user how to fix it", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await onboard(page);
  await page.getByRole("link", { name: /Free talk/ }).click();
  await page.getByTestId("mic").click();
  await expect(page.getByTestId("dock-hint")).toHaveText(/Microphone access is off/);
});

test("finishing without speaking saves nothing", async ({ page }) => {
  await onboard(page);
  await page.getByRole("link", { name: "Start lesson" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("nothing was saved")).toBeVisible();
  await page.getByRole("link", { name: "Back to today" }).click();
  await expect(page.getByTestId("streak")).toContainText("0");
});

test("role-play opens in character", async ({ page }) => {
  await onboard(page, "Travel");
  await page.getByRole("link", { name: /Customs officer|Hotel check-in|Ordering dinner/ }).first().click();
  await expect(page.locator(".talk-head h1")).toHaveText(/Customs officer|Hotel check-in|Ordering dinner/);
  await expect(page.locator(".bubble.coach").first()).not.toBeEmpty();
});
