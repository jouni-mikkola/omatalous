import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { cents, linkFakeBank, makeMember, overflow, removeMember, sayJointUse, waitForSync, watch } from "./helpers.ts";

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

/** The month `back` months before this one, "YYYY-MM". This one is the app's (Helsinki's), which is a day ahead of UTC for the two hours after midnight. */
const monthBack = (back: number): string => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 - back, 1)).toISOString().slice(0, 7);
};
const LAST = monthBack(1);

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  for (const name of NAMES) {
    const member = await makeMember(browser, name);
    members.push(member);
    const context = await browser.newContext({ storageState: member.state });
    // a joint account of its own: another spec on this server that linked the shared one has frozen its closed months for its own members
    await linkFakeBank(await context.newPage(), { own: true });
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
/**
 * What a member paid over (positive) or under (negative) the share, and the share, in the block of the pool.
 * The block is read again until the figures stand in it: a read made as the page renders finds no row yet.
 */
async function standing(page: Page, name: string): Promise<{ paid: number; owed: number; over: number }> {
  const block = poolOf(page).getByRole("group", { name, exact: true });
  const read = async () => {
    const paid = await figure(block, "Maksanut");
    const owed = await figure(block, "Osuus");
    if (paid === null || owed === null) return null;
    const over = (await figure(block, "Maksoi osuuttaan enemmän")) ?? -((await figure(block, "Maksoi osuuttaan vähemmän")) ?? 0);
    return { paid, owed, over };
  };
  // a row can go away between the count and the read while the page renders: that is one more round, not a failure
  const once = () => read().catch(() => null);
  await expect.poll(once, { message: `the figures of ${name}`, timeout: 15_000 }).not.toBeNull();
  // the same figures twice in a row: a first render that is still filling in does not count
  let last = JSON.stringify(await once());
  await expect.poll(async () => { const now = JSON.stringify(await once()); const same = now === last; last = now; return same; }, { timeout: 15_000 }).toBe(true);
  return (await read())!;
}
async function showMonth(page: Page, month: string) {
  await page.getByRole("combobox", { name: "Kuukausi" }).selectOption(month);
  await expect(poolOf(page)).toBeVisible({ timeout: 15_000 });
}

let lastMonth: { a: { paid: number; owed: number; over: number }; b: { paid: number; owed: number; over: number } };

test("Raportit shows the month of the joint account: paid, share and who paid over, summing to nothing", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!, "/#/reports?q=yhteiset");
  await expect(page.getByRole("heading", { name: "Tasaus", level: 2, exact: true })).toBeVisible();
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
  // who owes whom: the one under the share pays the other, and the total is the sum of its rows
  const owes = poolOf(page).getByRole("group", { name: "Kuka on velkaa kenelle" });
  const debtor = a.over < 0 ? NAMES[0] : NAMES[1];
  const creditor = a.over < 0 ? NAMES[1] : NAMES[0];
  const rows = owes.locator(".st-row:not(.st-total)").filter({ hasText: "→" });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`${debtor} → ${creditor}`);
  const line = cents(await rows.first().locator(".st-num").innerText());
  expect(line).toBe(Math.abs(a.over));
  expect(cents(await owes.locator(".st-total .st-num").innerText())).toBe(line);
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
    await form.getByLabel("Jakotapa").selectOption("share");
    await form.getByLabel(`${NAMES[0]} osuus`).fill("75");
    await form.getByLabel(`${NAMES[1]} osuus`).fill("25");
    await form.getByLabel("Voimassa alkaen").fill(day);
    await form.getByRole("button", { name: "Tallenna" }).click();
    return form;
  };
  await change(`${LAST}-01`);
  await expect(split).toContainText("Osuuksien mukaan");
  await expect(split).toContainText(`${NAMES[0]} 75 %`);
  await expect(split.getByRole("form")).toHaveCount(0);
  // the same day again: the server's line stands under the form
  const form = await change(`${LAST}-01`);
  await expect(form.locator('.notice[data-tone="error"]')).toHaveText("Tälle päivälle on jo sopimus.");
  await form.getByRole("button", { name: "Peruuta" }).click();
  // the refusal is the 400 the page shows as a line; nothing else went wrong
  expect(seen.problems.filter((p) => !p.includes("/api/settlement/agreements/"))).toEqual([]);
  await context.close();

  const reports = await open(browser, members[0]!, "/#/reports?q=yhteiset");
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
    await form.getByLabel("Jakotapa").selectOption("income");
    await form.getByLabel("Voimassa alkaen").fill(day);
    await form.getByRole("button", { name: "Tallenna" }).click();
    await expect(split).toContainText(`Odottaa hyväksyntää: ${NAMES[1]}`);
    return { context, split };
  };

  // the one who proposes can take it back; the earlier split holds meanwhile
  const first = await propose(`${today}-01`);
  await expect(first.split.getByRole("button", { name: "Peruuta ehdotus" })).toBeVisible();
  await expect(first.split.getByRole("button", { name: "Hyväksy" })).toHaveCount(0);
  await expect(first.split).toContainText("Osuuksien mukaan");
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
    const { context, page, seen } = await open(browser, outsider, "/#/reports?q=yhteiset");
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
  await page.goto("/#/settings/members");
  const card = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Talouden jäsenet", level: 2 }) });
  await expect(page.getByRole("heading", { name: "Jäsenet ilman tunnusta" })).toHaveCount(0);
  await card.getByRole("button", { name: "Lisää jäsen", exact: true }).click();
  await card.getByLabel("Ilman kirjautumista").check();
  await card.getByLabel("Nimi", { exact: true }).fill("Liisa Esimerkki");
  await card.getByRole("button", { name: "Lisää jäsen", exact: true }).click();
  const row = card.getByRole("row").filter({ hasText: "Liisa Esimerkki" });
  await expect(row).toContainText("ei kirjautumista");
  // the same name twice is refused by the server
  await card.getByRole("button", { name: "Lisää jäsen", exact: true }).click();
  await card.getByLabel("Ilman kirjautumista").check();
  await card.getByLabel("Nimi", { exact: true }).fill("liisa esimerkki");
  await card.getByRole("button", { name: "Lisää jäsen", exact: true }).click();
  await expect(card.locator('.notice[data-tone="error"]')).toHaveText("Sama nimi on kahdesti.");
  await card.getByRole("button", { name: "Poista Liisa Esimerkki" }).click();
  await page.getByRole("dialog", { name: "Poista Liisa Esimerkki?" }).getByRole("button", { name: "Poista Liisa Esimerkki" }).click();
  await expect(row).toHaveCount(0);
  await context.close();
});

for (const width of [390, 1440]) {
  test(`Yhteiset menot has its own address and shows who owes whom without scrolling sideways at ${width} px`, async ({ browser }) => {
    const { context, page } = await open(browser, members[0]!, "/#/reports?q=yhteiset", width);
    await expect(page.getByRole("heading", { name: "Tasaus", level: 2, exact: true })).toBeVisible();
    await showMonth(page, LAST);
    await expect(poolOf(page).getByRole("group", { name: "Kuka on velkaa kenelle" })).toBeVisible();
    expect(await overflow(page), `Yhteiset menot at ${width} px`).toBeLessThanOrEqual(0);
    await context.close();
  });
}

// Two members who link the joint account and tell nothing of its split: Tasaus asks for the split and names the sum, and lists no member with 0,00 €.
for (const width of [390, 1440]) {
  test(`a joint account with no split shows the question and the sum, no shares and no zero rows at ${width} px`, async ({ browser }) => {
    test.setTimeout(120_000);
    const pair: Member[] = [];
    try {
      for (const name of ["e2e-tasaus-a", "e2e-tasaus-b"]) {
        const member = await makeMember(browser, name);
        pair.push(member);
        const linked = await browser.newContext({ storageState: member.state });
        await linkFakeBank(await linked.newPage());
        await waitForSync(linked);
        await linked.close();
      }
      const { context, page, seen } = await open(browser, pair[0]!, "/#/reports?q=yhteiset", width);
      await expect(page.getByRole("heading", { name: "Tasaus", level: 2, exact: true })).toBeVisible();
      await showMonth(page, LAST);
      const pool = poolOf(page);
      await expect(pool.getByRole("group", { name: "Et ole kertonut jakoa" })).toBeVisible();
      await expect(pool.getByRole("link", { name: "Kerro, miten tili jakautuu" })).toBeVisible();
      await expect(pool.getByText("Menot, joille ei ole osuuksia")).toBeVisible();
      await expect(pool.getByText("Maksanut", { exact: true })).toHaveCount(0);
      await expect(pool.getByText("Osuus", { exact: true })).toHaveCount(0);
      await expect(pool.getByText(/^0,00\s€$/)).toHaveCount(0);
      expect(await overflow(page), `Tasaus at ${width} px`).toBeLessThanOrEqual(0);
      expect(seen.problems).toEqual([]);
      await context.close();
    } finally {
      for (const m of pair) await removeMember(browser, m.id);
    }
  });
}
