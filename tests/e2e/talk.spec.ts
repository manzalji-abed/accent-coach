import { expect, test } from "@playwright/test";
import { onboard, speakTurn } from "./helpers";

test("coach failure shows a clear error and Send again recovers", async ({ page }) => {
  await onboard(page);
  await page.route("**/api/turn", (route) => route.fulfill({ status: 502, json: { error: "Couldn't reach the coach. Check your connection and try again." } }));
  await page.getByRole("link", { name: /Free talk/ }).click();
  await speakTurn(page);
  await expect(page.getByTestId("dock-hint")).toHaveText(/Couldn.t reach the coach/);
  await expect(page.getByTestId("user-bubble")).toHaveCount(0);

  await page.unroute("**/api/turn");
  await page.getByRole("button", { name: "Send again" }).click();
  await expect(page.getByTestId("user-bubble")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Send again" })).toBeHidden();
});

test("a too-quick tap explains how to record", async ({ page }) => {
  await onboard(page);
  await page.getByRole("link", { name: /Free talk/ }).click();
  await speakTurn(page, 100);
  await expect(page.getByTestId("dock-hint")).toHaveText(/too quick/);
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
