import { expect, test } from "@playwright/test";
import { linkFakeBank, makeMember, removeMember, waitForSync } from "./helpers.ts";

// Asetukset > Pankit ja tilit > Tiliote tiedostosta: a bank's export is read in the browser, the columns are matched once and
// remembered, and only the rows leave it. The made-up export carries a marker no row holds, and no request may carry the marker, the header or the file name.
// The marker's words must not be ones the guess takes for a text column ("otsikko" is one, and ranks above a bare "Saaja/Maksaja").
const MARKER = "SALAINEN-MERKKI-E2E";
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

// A year's file: 2 500 rows are saved in parts of whole days, and the count of transactions is 2 500.
test("a 2 500-row bank file is saved in one go", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "pankkivuosi");
  const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const rows = Array.from({ length: 2500 }, (_, i) => {
    const d = new Date(Date.UTC(2020, 0, 1 + (i % 250)));
    return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.2020;-${1 + (i % 90)},00;KAUPPA ${i % 13}`;
  });
  const file = ["Kirjauspäivä;Määrä EUR;Saaja/Maksaja", ...rows].join("\n");
  try {
    await page.goto("/#/settings");
    await page.locator('input[data-kind="statement-file"]').setInputFiles({ name: "vuosi.csv", mimeType: "text/csv", buffer: Buffer.from(file, "utf8") });
    await page.getByLabel("Summan sarake").selectOption({ label: "Määrä EUR" });
    await page.getByLabel("Tilin nimi").fill("Vuositili");
    await page.getByRole("button", { name: "Tallenna rivit" }).click();
    await expect(page.getByText(/Uusia rivejä 2500, valmiiksi tallessa olleita 0/)).toBeVisible();
    const meta = (await (await context.request.get("/api/meta")).json()) as { accounts: { id: string; provider: string }[] };
    const account = meta.accounts.find((a) => a.provider === "bankfile")!;
    const listed = (await (await context.request.get(`/api/transactions?limit=1&accountId=${account.id}`)).json()) as { total: number };
    const count = listed.total;
    expect(count).toBe(2500);
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

// The file pages say why a save failed: a connected account is offered and reports the rows it skipped, a row dated tomorrow is left out and named,
// and a refusal shows the server's sentence. Screens at both widths go to the PR.
const csv = (rows: [string, string, string][]) => ["Kirjauspäivä;Määrä EUR;Saaja/Maksaja", ...rows.map(([d, a, n]) => `${d};${a};${n}`)].join("\n");
const fi = (iso: string) => iso.split("-").reverse().join(".");
const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  test(`a bank file into a connected account reports skipped rows, leaves out a future row and shows the refusal (${width} px)`, async ({ browser }) => {
    const { state, id } = await makeMember(browser, `pankkitiedosto${width}`);
    const context = await browser.newContext({ storageState: state, viewport: { width, height } });
    const page = await context.newPage();
    const pick = (file: string) => page.locator('input[data-kind="statement-file"]').setInputFiles({ name: "tilitapahtumat.csv", mimeType: "text/csv", buffer: Buffer.from(file, "utf8") });
    const columns = async () => {
      await page.getByLabel("Summan sarake").selectOption({ label: "Määrä EUR" });
    };
    try {
      await linkFakeBank(page);
      await waitForSync(context);
      const meta = (await (await context.request.get("/api/meta")).json()) as { today: string; accounts: { id: string; name: string; provider: string; type: string }[] };
      const connected = meta.accounts.find((a) => a.provider === "enablebanking" && a.type === "checking")!;
      expect(connected).toBeTruthy();
      const stored = ((await (await context.request.get("/api/transactions?limit=500")).json()) as { items: { accountId: string; bookingDate: string; amountCents: number; merchant: string; status: string }[] }).items;
      const bank = stored.find((r) => r.accountId === connected.id && r.status === "booked" && r.amountCents !== 0)!;
      expect(bank).toBeTruthy();
      // the household's tomorrow: the server's day is on Helsinki time, which is a day ahead of the runner's clock for two hours each evening
      const tomorrow = new Date(Date.parse(`${meta.today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const same: [string, string, string] = [fi(bank.bookingDate), money(bank.amountCents), bank.merchant];
      const fresh: [string, string, string] = ["01.01.2020", "-12,34", "UUSI KAUPPA E2E"];

      // the connected account is offered, and a row the bank already gave is reported as skipped
      await page.goto("/#/settings");
      await pick(csv([same, fresh]));
      await columns();
      await page.getByRole("combobox", { name: "Tili", exact: true }).selectOption({ value: connected.id });
      await page.getByRole("button", { name: "Tallenna rivit" }).click();
      await expect(page.getByText(/Ohitettu 1 riviä/)).toBeVisible();
      await page.screenshot({ path: `test-results/bank-file-skipped-${width}.png`, fullPage: true });

      // a row dated tomorrow is left out and named; the other row is saved
      await page.goto("/#/settings");
      await pick(csv([["02.01.2020", "-5,00", "AIKAISEMPI RIVI"], [fi(tomorrow), "-7,00", "HUOMISEN RIVI"]]));
      await columns();
      await page.getByRole("combobox", { name: "Tili", exact: true }).selectOption({ value: connected.id });
      await page.getByRole("button", { name: "Tallenna rivit" }).click();
      await expect(page.getByText(/Uusia rivejä 1,/)).toBeVisible();
      await expect(page.getByText(/Yksi rivi jätettiin pois.*HUOMISEN RIVI/)).toBeVisible();
      await page.screenshot({ path: `test-results/bank-file-left-out-${width}.png`, fullPage: true });

      // a refused save shows the server's sentence, not "Yritä uudelleen"
      await page.route("**/api/bank-file", async (route) => {
        const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
        await route.continue({ postData: JSON.stringify({ ...body, accountId: "ei-ole-olemassa" }) });
      });
      await page.goto("/#/settings");
      await pick(csv([["03.01.2020", "-9,00", "KOLMAS RIVI"]]));
      await columns();
      await page.getByLabel("Tilin nimi").fill("Uusi tili");
      await page.getByRole("button", { name: "Tallenna rivit" }).click();
      await expect(page.getByText("Rivejä ei voi tallentaa tälle tilille.")).toBeVisible();
      await expect(page.getByText(/Yritä uudelleen/)).toHaveCount(0);
      await page.screenshot({ path: `test-results/bank-file-refused-${width}.png`, fullPage: true });
    } finally {
      await context.close();
      await removeMember(browser, id);
    }
  });
}
