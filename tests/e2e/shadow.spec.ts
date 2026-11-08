import { expect, test } from "@playwright/test";
import { onboard, speakTurn } from "./helpers";

test("shadowing: fail, retry, pass, and move through the set", async ({ page }) => {
  await onboard(page, "Everyday talk");
  await page.getByRole("link", { name: /Shadowing/ }).click();
  const first = await page.getByTestId("shadow-sentence").textContent();

  await speakTurn(page);
  await expect(page.getByTestId("shadow-result")).toContainText("Try again");
  await expect(page.getByTestId("dock-hint")).toHaveText("Tap the mic to try again");

  await speakTurn(page);
  await expect(page.getByTestId("shadow-result")).toContainText("Clear. Nice.");
  await expect(page.getByTestId("mic")).toBeDisabled();
  await page.getByRole("button", { name: "Next sentence" }).click();
  await expect(page.getByTestId("shadow-sentence")).not.toHaveText(first!);

  // Skip the rest to reach the end screen.
  for (let i = 0; i < 4; i++) {
    await speakTurn(page);
    await page.getByRole("button", { name: /Skip this one|Next sentence|Finish/ }).click();
  }
  await expect(page.getByTestId("shadow-complete")).toBeVisible();
});
