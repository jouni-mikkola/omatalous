import { expect, test } from "@playwright/test";
import { makeMember, removeMember } from "./helpers.ts";

// Asetukset > Pankit ja tilit > Tiliote tiedostosta: a bank's export is read in the browser, the columns are matched once and
// remembered, and only the rows leave it. The made-up export carries a marker no row holds, and no request may carry the marker, the header or the file name.
const MARKER = "SALAINEN-OTSIKKO-MERKKI";
const FILE = [`Kirjauspäivä;Määrä EUR;Saaja/Maksaja;${MARKER}`, "03.09.2026;-23,40;PRISMA TIKKURILA;x", "05.09.2026;2 500,00;ACME OY;x"].join("\n");
const NAME = "tilitapahtumat-e2e-nimi.csv";

test("a bank CSV file is read in the browser, its columns are remembered and only its rows are sent", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "pankkitiedosto");
  const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const bodies: string[] = [];
  page.on("request", (r) => {
    bodies.push(`${r.url()} ${r.postData() ?? ""}`);
  });
  const pick = () => page.locator('input[data-kind="statement-file"]').setInputFiles({ name: NAME, mimeType: "text/csv", buffer: Buffer.from(FILE, "utf8") });
  try {
    await page.goto("/#/settings");
    await pick();
    await expect(page.getByText("PRISMA TIKKURILA")).toBeVisible();
    // the columns the header suggests are shown for the household to check; the text column is changed once
    await page.getByLabel("Summan sarake").selectOption({ label: "Määrä EUR" });
    await expect(page.getByRole("button", { name: "Tallenna rivit" })).toBeDisabled();
    await page.getByLabel("Tilin nimi").fill("Käyttötili");
    await page.getByRole("button", { name: "Tallenna rivit" }).click();
    await expect(page.getByText(/Uusia rivejä 2, valmiiksi tallessa olleita 0/)).toBeVisible();

    const saves = bodies.filter((b) => b.includes("/api/bank-file"));
    expect(saves).toHaveLength(1);
    expect(saves[0]).toContain("PRISMA TIKKURILA");
    for (const b of bodies) {
      expect(b).not.toContain(MARKER);
      expect(b).not.toContain(NAME);
    }

    // the same file again: the columns are remembered, and nothing new is stored
    await pick();
    await expect(page.getByText("Muistamme sarakkeet tämän pankin tiedostoille.")).toBeVisible();
    await page.getByRole("combobox", { name: "Tili", exact: true }).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Tallenna rivit" }).click();
    await expect(page.getByText(/Uusia rivejä 0, valmiiksi tallessa olleita 2/)).toBeVisible();
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});

// A camt.053 statement: the same rule for the request, and a closing balance that does not match the rows is refused with the difference.
const camt = (closing: string) =>
  `<?xml version="1.0"?><Document><BkToCstmrStmt><Stmt><Acct><Id><IBAN>FI2112345600000785</IBAN></Id></Acct>` +
  `<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>` +
  `<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${closing}</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>` +
  `<Ntry><Amt Ccy="EUR">23.40</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-09-03</Dt></BookgDt><NtryDtls><TxDtls><RltdPties><Cdtr><Nm>PRISMA TIKKURILA</Nm></Cdtr></RltdPties></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;

test("a camt.053 statement is refused with the difference when its balance is off, and read when it is right", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "pankkicamt");
  const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const bodies: string[] = [];
  page.on("request", (r) => {
    bodies.push(`${r.url()} ${r.postData() ?? ""}`);
  });
  const pick = (xml: string) => page.locator('input[data-kind="statement-file"]').setInputFiles({ name: "tiliote.xml", mimeType: "application/xml", buffer: Buffer.from(xml, "utf8") });
  try {
    await page.goto("/#/settings");
    await pick(camt("70.00"));
    await expect(page.getByText(/Emme ottaneet tiedostoa/)).toBeVisible();
    await expect(page.getByText(/erotus on .6,60/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Tallenna rivit" })).toHaveCount(0);
    await pick(camt("76.60"));
    await expect(page.getByText("PRISMA TIKKURILA")).toBeVisible();
    await page.getByLabel("Tilin nimi").fill("Camt-tili");
    await page.getByRole("button", { name: "Tallenna rivit" }).click();
    await expect(page.getByText(/Uusia rivejä 1, valmiiksi tallessa olleita 0/)).toBeVisible();
    for (const b of bodies) {
      expect(b).not.toContain("FI2112345600000785");
      expect(b).not.toContain("tiliote.xml");
    }
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});
