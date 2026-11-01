import { expect, test } from "@playwright/test";
import { makeMember, removeMember } from "./helpers.ts";

// Asetukset > Pankit ja tilit > Tiliote tiedostosta: a statement file is read in the browser and only its rows leave it.
// The made-up statement carries a marker no row holds, and no request of the run may carry the marker or the file name.
const MARKER = "SALAINEN-TIEDOSTON-MERKKI";
const FILE = [
  `Kortti;**** 4321;${MARKER}`,
  "Ostopäivä;Kirjauspäivä;Kauppa;Summa",
  "03.09.2026;04.09.2026;PRISMA TIKKURILA;23,40",
  "05.09.2026;06.09.2026;K-MARKET 24;1 234,56",
].join("\n");
const NAME = "tiliote-e2e-nimi.csv";

test("a card statement file is read in the browser and only its rows are sent", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "korttitiedosto");
  const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const bodies: string[] = [];
  page.on("request", (r) => {
    bodies.push(`${r.url()} ${r.postData() ?? ""}`);
  });
  try {
    await page.goto("/#/settings");
    await page.locator('input[data-kind="statement-file"]').setInputFiles({ name: NAME, mimeType: "text/csv", buffer: Buffer.from(FILE, "utf8") });
    await expect(page.getByText("PRISMA TIKKURILA")).toBeVisible();
    await page.getByRole("button", { name: "Tallenna rivit" }).click();
    await expect(page.getByText(/Uusia rivejä 2, valmiiksi tallessa olleita 0/)).toBeVisible();

    const saves = bodies.filter((b) => b.includes("/api/card-file"));
    expect(saves).toHaveLength(1);
    expect(saves[0]).toContain("PRISMA TIKKURILA");
    for (const b of bodies) {
      expect(b).not.toContain(MARKER);
      expect(b).not.toContain(NAME);
    }

    // the same file again stores nothing new
    await page.locator('input[data-kind="statement-file"]').setInputFiles({ name: NAME, mimeType: "text/csv", buffer: Buffer.from(FILE, "utf8") });
    await page.getByRole("button", { name: "Tallenna rivit" }).click();
    await expect(page.getByText(/Uusia rivejä 0, valmiiksi tallessa olleita 2/)).toBeVisible();
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});
