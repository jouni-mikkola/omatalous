import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { watch } from "./helpers.ts";

// Asetukset > Lainat reads a bank's loan view from a picture. The picture is taken here, by the test's own browser, from
// two made-up views (fixtures/loan-views: a home loan's "Lainan tiedot" dialog over its dimmed page, and a flexible
// credit's page), at device scale 1 and 2, and it is fed to the page the way a household does. Every name, number and sum
// in them is made up. A figure the recognition gets wrong is named with its picture and scale in the failure.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const VIEWS = fileURLToPath(new URL("./fixtures/loan-views/", import.meta.url));
/** The most a reading may take on a busy machine; the test's own limit adds the time to draw the picture and open the page. */
const READING_MS = 240_000;
/** Set by a run that wants to see the pictures the test takes: SHOTS_DIR=/tmp/loan-pictures pnpm e2e e2e/loan-picture.spec.ts */
const SHOTS = process.env.SHOTS_DIR;

test.describe.configure({ timeout: READING_MS + 60_000 });

interface Shot {
  /** What the picture shows, for the failure message. */
  name: string;
  file: string;
  /** The part of the page the picture is of; the whole viewport when absent. */
  of?: string;
  scale: 1 | 2;
}

/** The picture of a view: what the browser draws at that device scale, as a PNG. */
async function take(browser: Browser, shot: Shot): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: shot.scale, locale: "fi-FI" });
  try {
    const page = await context.newPage();
    await page.goto(pathToFileURL(join(VIEWS, shot.file)).href);
    return await (shot.of ? page.locator(shot.of).screenshot() : page.screenshot());
  } finally {
    await context.close();
  }
}

/** The fields of the form "Luettu laina" by the label the household sees; a field the kind of loan hides is null. */
const FIELDS = {
  lender: "Lainanantaja",
  balance: "Lainaa jäljellä (€)",
  granted: "Myönnetty määrä (€)",
  limit: "Luottoraja (€)",
  rate: "Kokonaiskorko (%)",
  repayment: "Lyhennystapa",
  interval: "Lyhennysväli",
  payment: "Maksuerä (€)",
  end: "Viimeinen eräpäivä",
  kind: "Laji",
} as const;
type Field = keyof typeof FIELDS;
type Form = Record<Field, string | null>;

async function valueOf(draft: Locator, label: string): Promise<string | null> {
  const input = draft.getByLabel(label, { exact: true });
  return (await input.count()) === 0 ? null : input.inputValue();
}

/** Feeds the picture to Asetukset > Lainat and waits for the form it fills. Returns the form and every text the form holds. */
async function readPicture(browser: Browser, png: Buffer): Promise<{ form: Form; texts: string[]; ms: number; recognised: string }> {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 900 }, locale: "fi-FI", timezoneId: "Europe/Helsinki" });
  try {
    const page: Page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/settings");
    const card = page.locator("#lainat");
    const started = Date.now();
    await card.getByLabel("Kuva tai PDF lainasta").setInputFiles({ name: "lainan-tiedot.png", mimeType: "image/png", buffer: png });
    await expect(card.locator(".loan-status")).toHaveText(/^Löytyi \d+ lai?na/, { timeout: READING_MS });
    const ms = Date.now() - started;
    // one view is one loan: a second form means the reading cut it in two, and the lines each form came from say where
    const forms = card.locator("section.loan-draft");
    const sources = await forms.evaluateAll((els) => els.map((el) => Array.from(el.querySelectorAll(".loan-source"), (line) => line.textContent)));
    // the text the recognition gave stands in the box, and is the first thing to read when a picture goes wrong
    const recognised = await card.getByLabel("Liitä kuva tai teksti lainasta").inputValue();
    expect(sources.length, [JSON.stringify(sources), recognised].join("\n")).toBe(1);
    const draft = card.getByRole("region", { name: "Luettu laina" });
    const form = {} as Form;
    for (const [key, label] of Object.entries(FIELDS) as [Field, string][]) form[key] = await valueOf(draft, label);
    const texts = await draft.locator("input:not([type=checkbox]), select").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    expect(seen.problems).toEqual([]);
    return { form, texts, ms, recognised };
  } finally {
    await context.close();
  }
}

/** The values the form must never hold: an interest in euros, a minimum, a count, the number of a loan, a person's name, an icon. */
const NEVER = /^(?:440,33|44033|19,40|2,00|9 120,00|0,00|13 759,45|7 300,00|360|O)$|123456|654321|MEIKÄLÄINEN|ESIMERKKI|MATTI|ELISA|OLAVI/i;

/** What each fill of the form said against what the picture shows: one line per field that differs. */
function differences(name: string, scale: number, got: Form, want: Partial<Form>): string[] {
  return (Object.keys(want) as Field[]).filter((key) => got[key] !== want[key]).map((key) => `${name} at scale ${scale}: ${FIELDS[key]} was ${JSON.stringify(got[key])}, expected ${JSON.stringify(want[key])}`);
}

// The dialog's own rows. The payment is empty: the dialog gives only the amortisation, and the form says so and leaves the payment to type.
const DIALOG: Partial<Form> = { lender: "Nordea Kiinnitysluottopankki", balance: "171 240,55", granted: "185 000,00", repayment: "annuity", interval: "1", end: "2052-03-14", kind: "mortgage", payment: "" };
// What the page behind the dialog adds: the rate, and the whole payment of the next instalment.
const BEHIND: Partial<Form> = { rate: "3,09", payment: "742,10" };
// A flexible credit has no lender on its page, and its kind hides the granted sum, the way of repayment, the payment and the last day.
const CREDIT: Partial<Form> = { lender: "", balance: "2 700,00", limit: "", rate: "8,40", kind: "credit_line", granted: null, repayment: null, interval: null, payment: null, end: null };

const HOME_PAGE = { name: "the home loan's page with the dialog over it", file: "home-loan-dialog.html" };
const HOME_DIALOG = { name: "the home loan's dialog alone", file: "home-loan-dialog.html", of: ".dialog" };
const CREDIT_PAGE = { name: "the flexible credit's page", file: "flexible-credit.html", of: "main" };

/** Takes the picture, reads it in the app, and says what differs from `want`; a value that must never be there is a difference too. */
async function check(browser: Browser, shot: Shot, want: Partial<Form>): Promise<void> {
  const png = await take(browser, shot);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, `loan-picture-${shot.file.replace(/\.html$/, "")}${shot.of ? shot.of.replace(/\W/g, "-") : ""}-${shot.scale}x.png`), png);
  }
  const { form, texts, ms, recognised } = await readPicture(browser, png);
  test.info().annotations.push({ type: "reading", description: `${ms} ms` });
  expect(differences(shot.name, shot.scale, form, want), recognised).toEqual([]);
  // what the view prints that is no value of the loan reaches no field
  expect(texts.filter((value) => NEVER.test(value.trim()))).toEqual([]);
}

for (const scale of [1, 2] as const) {
  test(`${HOME_PAGE.name}, drawn at scale ${scale}, fills the form from the dialog`, async ({ browser }) => {
    await check(browser, { ...HOME_PAGE, scale }, DIALOG);
  });

  test(`${HOME_DIALOG.name}, drawn at scale ${scale}, fills the form`, async ({ browser }) => {
    await check(browser, { ...HOME_DIALOG, scale }, DIALOG);
  });

  test(`${CREDIT_PAGE.name}, drawn at scale ${scale}, fills the form`, async ({ browser }) => {
    await check(browser, { ...CREDIT_PAGE, scale }, CREDIT);
  });

  // Known: the reader gives the dialog's rows and nothing of the page dimmed behind it (not even its heading), so the rate and
  // the next payment of the page are not in the form. The test is marked to fail, so that it goes red the day the reader reads them.
  test(`${HOME_PAGE.name}, drawn at scale ${scale}, also gives the rate and the next payment of the dimmed page`, async ({ browser }) => {
    test.fail(true, "the page behind a dimmed dialog is not read");
    await check(browser, { ...HOME_PAGE, scale }, BEHIND);
  });
}
