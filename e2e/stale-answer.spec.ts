import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow } from "./helpers.ts";

// Nyt on a phone when its second load fails (design section 4, error): the first answer stays on the page, and one line
// says what failed, from when the shown answer is and how to ask again. Runs on the demo household that e2e/run.mjs makes.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const SENTENCE = "Palvelin ei vastaa.";

/** A time as the app writes it in the instance's time zone: "11.11. klo 12.05". */
function shown(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const of = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${of("day")}.${of("month")}. klo ${Number(of("hour"))}.${of("minute")}`;
}

test("390 px: a failed second load of Nyt keeps the first answer, with its time and the one line", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  // the first answer comes at `t0` on the browser's clock and the failure five minutes later, so the two times read apart
  const t0 = new Date();
  t0.setSeconds(0, 0);
  const later = new Date(t0.getTime() + 5 * 60_000);
  const { timezone } = (await (await context.request.get("/api/auth/state")).json()) as { timezone: string };
  await page.clock.setFixedTime(t0);
  await page.goto("/#/overview");
  const answer = page.locator(".home-tiles");
  await expect(page.locator(".home-tiles")).toBeVisible({ timeout: 15_000 });
  const first = await answer.innerText();
  const line = page.locator(".stale-answer");
  await expect(line, "no line over a fresh answer").toHaveCount(0);

  // the server fails the view's request from here on, and the answer on the page grows old: the view asks again when it opens
  let down = true;
  let asked = 0;
  await page.route("**/api/dashboard*", (route) => {
    if (!down) return route.continue();
    asked++;
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: SENTENCE }) });
  });
  await page.clock.setFixedTime(later);
  await page.goto("/#/bills");
  await expect(page.getByRole("heading", { level: 1, name: "Laskut" })).toBeVisible();
  await page.goto("/#/overview");

  await expect(line).toHaveCount(1, { timeout: 15_000 });
  expect(asked, "the second load was asked of the server").toBeGreaterThan(0);
  await expect(line).toContainText(SENTENCE);
  await expect(line, "the time of the answer that stays").toContainText(`Tulokset ajalta ${shown(t0, timezone)}.`);
  await expect(line, "not the time of the failure").not.toContainText(shown(later, timezone));
  await expect(page.getByText("Emme saaneet tietoja haettua. Yritä uudelleen."), "the answer is not replaced by the failure").toHaveCount(0);
  expect(await answer.innerText(), "the first answer stays").toBe(first);
  const box = (await line.boundingBox())!;
  expect(box.x + box.width, "the line ends on the screen").toBeLessThanOrEqual(390);
  expect(await overflow(page), "the page scrolls sideways").toBe(0);

  // what to do: the button asks again, and a load that succeeds takes the line away
  down = false;
  await line.getByRole("button", { name: "Yritä uudelleen" }).click();
  await expect(line).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".home-tiles")).toBeVisible();
  await context.close();
});
