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

test("native samples ask for Gemini's voice first, fall back cleanly, and the conversation carries on", async ({ page }) => {
  await onboard(page);
  await page.getByRole("link", { name: /Free talk/ }).click();
  await speakTurn(page);
  const bubble = page.getByTestId("user-bubble").first();

  await bubble.getByRole("button", { name: /think: see how to say it/ }).click();
  const sheet = page.getByTestId("word-sheet");
  const native = page.waitForRequest((r) => r.url().endsWith("/api/tts") && r.method() === "POST");
  await sheet.getByRole("button", { name: "Play native" }).click();
  expect(JSON.parse((await native).postData() ?? "{}")).toMatchObject({ text: "think" });
  await sheet.getByRole("button", { name: "Done" }).click();

  await bubble.getByTestId("correction-chip").click();
  const fix = page.getByTestId("correction-sheet");
  const hear = page.waitForRequest((r) => r.url().endsWith("/api/tts"));
  await fix.getByRole("button", { name: "Hear it" }).click();
  expect(JSON.parse((await hear).postData() ?? "{}")).toMatchObject({ text: "I feel comfortable talking about my work." });
  await fix.getByRole("button", { name: "Done" }).click();

  await speakTurn(page);
  await expect(page.getByTestId("user-bubble")).toHaveCount(2);
});

test("free talk lets you pick who to talk to", async ({ page }) => {
  await onboard(page);
  await page.getByRole("link", { name: /Free talk/ }).click();
  await expect(page.getByTestId("persona-picker")).toBeVisible();
  await expect(page.getByTestId("persona-name")).toContainText("Omar Haddad");
  await page.getByText("Maya Chen").click();
  await expect(page.getByTestId("persona-name")).toContainText("Maya Chen");

  await page.getByTestId("mic").click();
  await expect(page.getByTestId("mic")).toHaveAttribute("data-state", "recording");
  await expect(page.getByTestId("persona-picker")).toHaveCount(0);
  await expect(page.getByTestId("persona-name")).toContainText("Maya Chen");
});

test("continue a finished conversation: old turns show and one more turn is added to the same session", async ({ page }) => {
  await onboard(page);
  await page.getByRole("link", { name: /Free talk/ }).click();
  await speakTurn(page);
  await expect(page.getByTestId("user-bubble")).toHaveCount(1);
  await page.getByRole("button", { name: "Finish" }).click();
  await page.goto("/");

  await page.getByTestId("continue-link").first().click();
  await expect(page).toHaveURL(/\/talk\?resume=/);
  await expect(page.getByTestId("user-bubble")).toHaveCount(1);

  await speakTurn(page);
  await expect(page.getByTestId("user-bubble")).toHaveCount(2);

  await page.goto("/progress");
  await expect(page.getByTestId("continue-link")).toHaveCount(1);
});

test("pick who you're talking to; the tip names the audience and the summary names the habits", async ({ page }) => {
  await onboard(page);
  await page.getByRole("link", { name: /Free talk/ }).click();
  await expect(page.getByTestId("audience-select")).toHaveValue("peer");
  await expect(page.getByTestId("intent-select")).toHaveValue("small-talk");
  await page.getByTestId("audience-select").selectOption("ceo");
  await page.getByTestId("intent-select").selectOption("explain-problem");

  let body: Record<string, string> = {};
  await page.route("**/api/live", async (route) => {
    body = JSON.parse(route.request().postData() ?? "{}");
    await route.continue();
  });
  await speakTurn(page);
  await expect(page.getByTestId("comms-picker")).toHaveCount(0);
  expect(body).toMatchObject({ audienceId: "ceo", intentId: "explain-problem" });

  await page.getByTestId("correction-chip").first().click();
  const sheet = page.getByTestId("correction-sheet");
  await expect(sheet.getByTestId("comms-tip")).toContainText("For a CEO");
  await expect(sheet.getByTestId("comms-tip")).toContainText("lead with your point");
  await sheet.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByTestId("comms-habits")).toContainText("Strongest habit:");
  await expect(page.getByTestId("comms-habits")).toContainText("Change this:");
});

test("a communication scenario preselects its audience and goal", async ({ page }) => {
  await onboard(page);
  await page.goto("/talk?scenario=rp-outage");
  await expect(page.locator(".talk-head h1")).toHaveText("Explain an outage to your CEO in 60 seconds");
  await expect(page.getByTestId("audience-select")).toHaveValue("ceo");
  await expect(page.getByTestId("intent-select")).toHaveValue("explain-problem");
});
