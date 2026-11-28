import { expect, request, test as base } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";
import { startServer } from "./server.mjs";

// Laskut on a phone keeps to MAX_HEIGHT px whatever the day of the month. The demo household's bills are dated from today, so the
// open month and how many of its rows are still to come change with the day: each day below runs on a server of its own whose
// clock starts on it (e2e/clock.mjs), in the month of the run. The 2nd: the running month open with nearly every bill to come.
// The 15th: the running month open, half of it paid. The 24th: every bill of the running month paid (the demo's last is on
// the 20th), so the next month opens with all of its bills to come.
const ADMIN = { username: "e2e-admin", displayName: "E2E Admin", password: "e2e-salasana-123456" };
const FETCH = { "X-Requested-With": "fetch" };
// The open month ends in the rows of its figures, and a low twelve-month chart stands under the table.
const MAX_HEIGHT = 2250;
const month = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit" }).format(new Date());
const DAYS = [
  { day: 2, open: "running" },
  { day: 15, open: "running" },
  { day: 24, open: "next" },
] as const;

for (const { day, open } of DAYS) {
  const today = `${month}-${String(day).padStart(2, "0")}`;
  let app: Awaited<ReturnType<typeof startServer>>;
  let state = "";
  // (the hooks run with the auto fixtures too, so the address is asked for once before there is a server)
  const test = base.extend({ baseURL: async ({}, use) => use(app?.base) });
  test.describe(`on ${today}`, () => {
    test.beforeAll(async () => {
      app = await startServer({ today });
      const api = await request.newContext({ baseURL: app.base, extraHTTPHeaders: FETCH });
      try {
        for (const [path, data] of [
          ["/api/auth/setup", { code: app.setupCode, ...ADMIN }],
          ["/api/admin/instance/complete", undefined],
          ["/api/demo", undefined],
        ] as const) {
          const answer = await api.post(path, { data });
          if (!answer.ok()) throw new Error(`POST ${path} answered ${answer.status()} ${await answer.text()}`);
        }
        const meta = (await (await api.get("/api/meta")).json()) as { today: string };
        expect(meta.today, "the server's day").toBe(today);
        state = join(app.dir, "admin-state.json");
        await api.storageState({ path: state });
      } finally {
        await api.dispose();
      }
    });
    test.afterAll(() => app?.stop());

    test(`the Laskut page fits a phone: the table of the months is inside the screen at 390 px, in at most ${MAX_HEIGHT} px`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await context.clock.setFixedTime(new Date(`${today}T10:00:00Z`));
      const page = await context.newPage();
      const seen = watch(page);
      await page.goto("/#/bills");
      await expect(page.getByRole("heading", { name: "Laskut, sopimukset ja tilaukset" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      // a table wider than its card scrolls sideways inside the card and clips the last column
      const clipped = await page.evaluate(() => Array.from(document.querySelectorAll(".rt-wrap")).filter((w) => w.scrollWidth > w.clientWidth + 1).length);
      expect(clipped, "tables that scroll sideways").toBe(0);
      expect(await overflow(page), "Laskut scrolls sideways").toBeLessThanOrEqual(1);
      const wide = await page.evaluate(() => Array.from(document.querySelectorAll("table")).filter((t) => t.getBoundingClientRect().width > window.innerWidth + 1).length);
      expect(wide, "tables wider than the screen").toBe(0);
      // the one month the table shows, and the rows of it a card pays folded under one closed toggle
      await expect(page.locator("#laskut-taulukko .bill-month-name")).toHaveCount(1);
      expect(open, "the month the day shows").toMatch(/^(running|next)$/);
      const card = page.locator("#laskut-taulukko .bill-subfold").filter({ hasText: /Kortilla, \d+ lasku/ });
      await expect(card).toHaveCount(1);
      await expect(card).toHaveAttribute("aria-expanded", "false");
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      console.log(`Laskut at 390 px on ${today}: ${height} px`);
      expect(height, "page height at 390 px").toBeLessThanOrEqual(MAX_HEIGHT);
      expect(seen.problems).toEqual([]);
      await context.close();
    });
  });
}
