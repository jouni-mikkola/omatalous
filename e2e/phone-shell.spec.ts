import { expect, test } from "@playwright/test";
import { join } from "node:path";

// The phone's tab bar: the count of Tarkistettavat stays inside the screen and off the word. Runs on the demo household that e2e/run.mjs makes.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

for (const width of [390, 1440]) {
  test(`${width} px: the review count is inside the screen and off the word`, async ({ browser }) => {
    const phone = width < 600;
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 844 }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    await page.goto("/#/overview");
    const count = page.locator(".review-link .nav-count");
    await expect(count).toBeVisible();
    const m = await page.locator(".review-link").evaluate((a) => {
      const c = a.querySelector(".nav-count")!.getBoundingClientRect();
      const word = Array.from(a.childNodes).find((n) => n.nodeType === 3 && n.textContent?.trim())!;
      const r = document.createRange();
      r.selectNodeContents(word);
      const t = r.getBoundingClientRect();
      const box = (r: DOMRect) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom });
      return { c: box(c), t: box(t), vw: document.documentElement.clientWidth, vh: window.innerHeight };
    });
    expect(m.c.l).toBeGreaterThanOrEqual(2);
    expect(m.c.r).toBeLessThanOrEqual(m.vw - 2);
    expect(m.c.t).toBeGreaterThanOrEqual(2);
    expect(m.c.b).toBeLessThanOrEqual(m.vh - 2);
    const apart = m.c.l >= m.t.r || m.c.r <= m.t.l || m.c.t >= m.t.b || m.c.b <= m.t.t;
    expect(apart, JSON.stringify(m)).toBe(true);
  });
}
