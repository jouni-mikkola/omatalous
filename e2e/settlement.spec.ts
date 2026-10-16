import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { cents, linkFakeBank, makeMember, removeMember, sayJointUse, waitForSync, watch } from "./helpers.ts";

// Settlement between partners, as two members of the fake bank's joint account see it. Both link the fake bank, so the
// joint account has two users that use it half each; the payer of one deposit is nobody the app knows, so the first
// member says whose that money was (all), as Asetukset > Tilit asks. Raportit then shows the month split; the agreement
// is changed in Asetukset > Tilit. The members are made here and go at the end; the demo household of the other specs is not touched.
const NAMES = ["e2e-jako-a", "e2e-jako-b"] as const;
interface Member {
  state: string;
  id: string;
}
const members: Member[] = [];
const FETCH = { "X-Requested-With": "fetch" };

test.describe.configure({ mode: "serial" });

/** The month `back` months before this one, "YYYY-MM", and its first day. */
const monthBack = (back: number): string => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - back);
  return d.toISOString().slice(0, 7);
};
const LAST = monthBack(1);

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  for (const name of NAMES) {
    const member = await makeMember(browser, name);
    members.push(member);
    const context = await browser.newContext({ storageState: member.state });
    await linkFakeBank(await context.newPage());
    await waitForSync(context);
    if (members.length === 2) {
      const first = await browser.newContext({ storageState: members[0]!.state });
      await sayJointUse(first, members.map((m) => ({ userId: m.id, weight: 5000 })));
      await sayAllOfIt(first);
      await first.close();
    }
    await context.close();
  }
});
test.afterAll(async ({ browser }) => {
  for (const member of members) await removeMember(browser, member.id);
});

/** The first member says that every unasked payer's money and the opening balance of the joint account were everyone's. */
async function sayAllOfIt(context: BrowserContext): Promise<void> {
  const meta = await (await context.request.get("/api/meta")).json();
  const joint = (meta.accounts as { id: string; name: string; questions?: { kind: string; key: string }[] }[]).find((a) => a.name === "Yhteistili");
  expect(joint, "the joint account is linked").toBeTruthy();
  for (const q of joint!.questions ?? []) {
    const said = await context.request.put(`/api/accounts/${encodeURIComponent(joint!.id)}/answers`, { data: { kind: q.kind, key: q.key, owner: "all" }, headers: FETCH });
    expect(said.ok(), `PUT answers answered ${said.status()} ${await said.text()}`).toBe(true);
  }
}

async function open(browser: Browser, who: Member, path: string, width = 1280) {
  const context = await browser.newContext({ storageState: who.state, viewport: { width, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(path);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return { context, page, seen };
}

const poolOf = (page: Page) => page.getByRole("group", { name: "Yhteiset menot: Yhteistili" });
/** The figure of a labelled row inside `scope`, in cents; null when it has no such row. */
async function figure(scope: Locator, label: string): Promise<number | null> {
  const row = scope.locator(".st-row").filter({ has: scope.page().getByText(label, { exact: true }) });
  return (await row.count()) ? cents(await row.locator(".st-num").innerText()) : null;
}
/** What a member paid over (positive) or under (negative) the share, and the share, in the block of the pool. */
async function standing(page: Page, name: string): Promise<{ paid: number; owed: number; over: number }> {
  const block = poolOf(page).getByRole("group", { name, exact: true });
  const over = (await figure(block, "Maksanut enemmän kuin osuutensa")) ?? -(await figure(block, "Maksanut vähemmän kuin osuutensa") ?? 0);
  return { paid: (await figure(block, "Maksanut"))!, owed: (await figure(block, "Osuus"))!, over };
}
async function showMonth(page: Page, month: string) {
  await page.getByRole("combobox", { name: "Kuukausi" }).selectOption(month);
  await expect(poolOf(page)).toBeVisible({ timeout: 15_000 });
}

let lastMonth: { a: { paid: number; owed: number; over: number }; b: { paid: number; owed: number; over: number } };

test("Raportit shows the month of the joint account: paid, share and who paid over, summing to nothing", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!, "/#/reports");
  await expect(page.getByRole("heading", { name: "Yhteiset menot", level: 2 })).toBeVisible();
  await showMonth(page, LAST);
  const a = await standing(page, NAMES[0]);
  const b = await standing(page, NAMES[1]);
  expect(a.paid).toBeGreaterThan(0);
  expect(a.owed + b.owed).toBeGreaterThan(0);
  // equal shares: the two over figures cancel
  expect(a.over + b.over).toBe(0);
  expect(a.over).not.toBe(0);
  await expect(poolOf(page)).toContainText("lukittu");
  await expect(poolOf(page)).not.toContainText("toisen tilin tuntematon raha");
  lastMonth = { a, b };
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a new split from a day: the closed month stays, the month after names the correction, a day with a row is refused", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!, "/#/settings");
  const split = page.getByRole("group", { name: "Tilin Yhteistili jako" });
  await expect(split).toBeVisible();
  const change = async (day: string) => {
    await split.getByRole("button", { name: "Muuta jakoa" }).click();
    const form = page.getByRole("form", { name: "Muuta tilin Yhteistili jakoa" });
    await form.getByLabel("Miten jaetaan").selectOption("share");
    await form.getByLabel(`${NAMES[0]} osuus`).fill("75");
    await form.getByLabel(`${NAMES[1]} osuus`).fill("25");
    await form.getByLabel("Voimassa alkaen").fill(day);
    await form.getByRole("button", { name: "Tallenna" }).click();
    return form;
  };
  await change(`${LAST}-01`);
  await expect(split).toContainText("Osuuksina");
  await expect(split).toContainText(`${NAMES[0]} 75 %`);
  await expect(split.getByRole("form")).toHaveCount(0);
  // the same day again: the server's line stands under the form
  const form = await change(`${LAST}-01`);
  await expect(form.locator(".error")).toHaveText("Tälle päivälle on jo sopimus.");
  await form.getByRole("button", { name: "Peruuta" }).click();
  // the refusal is the 400 the page shows as a line; nothing else went wrong
  expect(seen.problems.filter((p) => !p.includes("/api/settlement/agreements/"))).toEqual([]);
  await context.close();

  const reports = await open(browser, members[0]!, "/#/reports");
  await showMonth(reports.page, LAST);
  // a closed month is not rewritten: the figures are as they were
  expect(await standing(reports.page, NAMES[0])).toEqual(lastMonth.a);
  expect(await standing(reports.page, NAMES[1])).toEqual(lastMonth.b);
  // the current month carries the correction and names the month it corrects
  await showMonth(reports.page, monthBack(0));
  const line = poolOf(reports.page).locator(".st-row").filter({ hasText: "Korjaus aiempaan kuukauteen" });
  await expect(line).toHaveCount(1);
  expect(await figure(poolOf(reports.page), (await line.locator("span").first().innerText()).trim())).not.toBe(0);
  expect(reports.seen.problems).toEqual([]);
  await reports.context.close();
});

test("an income split waits for the other user: she accepts it, or he takes it back", async ({ browser }) => {
  const today = monthBack(0);
  const jako = async (who: Member, width = 1280) => {
    const opened = await open(browser, who, "/#/settings", width);
    return { ...opened, split: opened.page.getByRole("group", { name: "Tilin Yhteistili jako" }) };
  };
  const propose = async (day: string) => {
    const { context, page, split } = await jako(members[0]!);
    await split.getByRole("button", { name: "Muuta jakoa" }).click();
    const form = page.getByRole("form", { name: "Muuta tilin Yhteistili jakoa" });
    await form.getByLabel("Miten jaetaan").selectOption("income");
    await form.getByLabel("Voimassa alkaen").fill(day);
    await form.getByRole("button", { name: "Tallenna" }).click();
    await expect(split).toContainText(`Odottaa hyväksyntää: ${NAMES[1]}`);
    return { context, split };
  };

  // the one who proposes can take it back; the earlier split holds meanwhile
  const first = await propose(`${today}-01`);
  await expect(first.split.getByRole("button", { name: "Peruuta ehdotus" })).toBeVisible();
  await expect(first.split.getByRole("button", { name: "Hyväksy" })).toHaveCount(0);
  await expect(first.split).toContainText("Osuuksina");
  await first.split.getByRole("button", { name: "Peruuta ehdotus" }).click();
  await expect(first.split).not.toContainText("Odottaa hyväksyntää");
  await first.context.close();

  // the user it names sees Hyväksy and Hylkää; Hylkää removes it
  const second = await propose(`${today}-01`);
  await second.context.close();
  const b = await jako(members[1]!);
  await expect(b.split).toContainText(`Odottaa hyväksyntää: ${NAMES[1]}`);
  await expect(b.split.getByRole("button", { name: "Peruuta ehdotus" })).toHaveCount(0);
  await b.split.getByRole("button", { name: "Hylkää" }).click();
  await expect(b.split).not.toContainText("Odottaa hyväksyntää");
  await b.context.close();

  // proposed again, she accepts: it stands from its day and is the split in force
  const third = await propose(`${today}-01`);
  await third.context.close();
  const accept = await jako(members[1]!);
  await accept.split.getByRole("button", { name: "Hyväksy" }).click();
  await expect(accept.split).not.toContainText("Odottaa hyväksyntää");
  await expect(accept.split.locator(".use-list").first()).toContainText("Tulojen suhteessa");
  expect(accept.seen.problems).toEqual([]);
  await accept.context.close();
});

test("a member who is not on the account sees no section, no split and no month", async ({ browser }) => {
  const outsider = await makeMember(browser, "e2e-jako-c");
  try {
    const { context, page, seen } = await open(browser, outsider, "/#/reports");
    await expect(page.getByRole("heading", { name: "Yhteiset menot" })).toHaveCount(0);
    const answer = await (await context.request.get(`/api/settlement?month=${LAST}`)).json();
    expect(answer.pools).toEqual([]);
    await page.goto("/#/settings");
    await expect(page.getByRole("heading", { name: "Tilit", level: 2 })).toBeVisible();
    await expect(page.getByRole("group", { name: /jako$/ })).toHaveCount(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  } finally {
    await removeMember(browser, outsider.id);
  }
});

test("the administrator adds a member without a login and takes her away", async ({ browser }) => {
  const dir = process.env.E2E_DIR ?? ".";
  const context = await browser.newContext({ storageState: `${dir}/admin-state.json`, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("/#/settings");
  const card = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Jäsenet ilman tunnusta", level: 2 }) });
  await card.getByLabel("Nimi", { exact: true }).fill("Liisa Esimerkki");
  await card.getByRole("button", { name: "Lisää", exact: true }).click();
  await expect(card.getByRole("listitem")).toContainText("Liisa Esimerkki");
  // the same name twice is refused by the server
  await card.getByLabel("Nimi", { exact: true }).fill("liisa esimerkki");
  await card.getByRole("button", { name: "Lisää", exact: true }).click();
  await expect(card.locator(".error")).toHaveText("Sama nimi on kahdesti.");
  page.once("dialog", (d) => void d.accept());
  await card.getByRole("button", { name: "Poista Liisa Esimerkki" }).click();
  await expect(card.getByRole("listitem")).toHaveCount(0);
  await context.close();
});
