import { expect, test } from "@playwright/test";
import { onboard, speakTurn } from "./helpers";

// Always recorded: this video becomes the GIF on each PR.
test.use({ video: { mode: "on", size: { width: 412, height: 839 } } });

test("@showcase live talk, see sentence fixes and flagged words, open Said vs Expected, finish with a takeaway", async ({ page }) => {
  await onboard(page);
  await page.getByRole("link", { name: /Free talk/ }).click();
  await expect(page.getByTestId("dock-hint")).toHaveText("Tap the mic to start talking with your coach");

  await speakTurn(page);
  const bubble = page.getByTestId("user-bubble").first();
  await expect(bubble).toContainText("comfortable");
  await expect(bubble.getByRole("button", { name: /think: see how to say it/ })).toBeVisible();
  await expect(bubble.getByLabel(/Clarity 78 percent/)).toBeVisible();
  // Whole-sentence fix, not just word by word: a chip that opens a sheet.
  await bubble.getByTestId("correction-chip").click();
  const fix = page.getByTestId("correction-sheet");
  await expect(fix).toContainText("I think I feel comfortable talking about my work.");
  await expect(fix).toContainText("I feel comfortable talking about my work.");
  await expect(fix).toContainText("Drop 'I think'");
  await page.waitForTimeout(600); // let the video show the sheet
  await fix.getByRole("button", { name: "Done" }).click();
  await expect(fix).toBeHidden();

  await bubble.getByRole("button", { name: /comfortable/ }).click();
  const sheet = page.getByTestId("word-sheet");
  await expect(sheet).toContainText("com-for-TA-ble");
  await expect(sheet).toContainText("COMF-ter-bul");
  await expect(sheet.getByRole("button", { name: "Play yours" })).toBeEnabled();
  await page.waitForTimeout(600); // let the video show the card
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();

  await speakTurn(page);
  await expect(page.getByTestId("user-bubble")).toHaveCount(2);

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByTestId("session-score")).toContainText("85");
  await expect(page.getByTestId("takeaway")).toContainText("Your main takeaway today");
  await expect(page.getByTestId("summary-corrections")).toContainText("You said: I think I feel comfortable talking about my work.");
  await expect(page.getByTestId("summary-corrections")).toContainText("Better: I feel comfortable talking about my work.");
  await page.waitForTimeout(600);

  await page.getByRole("link", { name: "Done" }).click();
  await expect(page.getByTestId("streak")).toContainText("1");

  await page.getByRole("link", { name: "Progress" }).click();
  await expect(page.getByTestId("trouble-words")).toContainText("comfortable");
  // Each slip is counted once per session, not once per save.
  await expect(page.getByTestId("trouble-words").locator(".misses").first()).toHaveText("1×");
  await expect(page.getByTestId("heatmap")).toContainText("/θ/");
  await page.waitForTimeout(600);
});
