import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow } from "./helpers.ts";

// Asetukset does not scroll sideways on a phone when a bank gives long holder names: the select of "Nimi pankin tiedoissa"
// (Jäsenet ilman tunnusta) is as wide as its longest option unless the form keeps it inside the card. The holders are the
// account holders of /api/meta, so the test gives the page long ones.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const LONG = [
  "Oy Esimerkki Ja Kumppanit Kiinteistöosakeyhtiö Helsingin Seudun Asuntosäätiö sr",
  "Maija-Liisa Esimerkkinen-Virtanen ja Juha-Matti Esimerkkinen-Virtanen yhteistili",
];

for (const width of [390, 320]) {
  test(`Asetukset does not scroll sideways at ${width} px with long holder names`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.route(/\/api\/meta(\?|$)/, async (route) => {
      const res = await route.fetch();
      const meta = await res.json();
      meta.accounts = [...meta.accounts, ...LONG.map((holder, i) => ({ ...meta.accounts[0], id: 900000 + i, holder }))];
      await route.fulfill({ response: res, json: meta });
    });
    await page.goto("/#/settings");
    const card = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Jäsenet ilman tunnusta", level: 2 }) });
    const select = card.getByLabel("Nimi pankin tiedoissa");
    await expect(select).toBeVisible();
    await expect(select.locator("option", { hasText: LONG[0]!.slice(0, 20) })).toHaveCount(1);
    expect(await overflow(page), `Asetukset at ${width} px`).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const box = await select.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await context.close();
  });
}
