import { expect, type Page } from "@playwright/test";

export async function onboard(page: Page, goal = "Business & career") {
  await page.goto("/");
  await expect(page).toHaveURL(/onboarding/);
  await page.getByRole("button", { name: new RegExp(goal) }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /American/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Daily practice time").fill("19:00");
  await page.getByRole("button", { name: "Start practising" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Good (morning|afternoon|evening)/);
}

/**
 * Tap the mic, "speak" (Chrome's fake mic plays a tone), tap again. In Shadowing that sends the
 * recording; in a live conversation it pauses the mic (demo mode hears one turn per stretch of talking).
 */
export async function speakTurn(page: Page, ms = 1500) {
  const mic = page.getByTestId("mic");
  await mic.click();
  await expect(mic).toHaveAttribute("data-state", "recording");
  await page.waitForTimeout(ms);
  await mic.click();
}
