import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, linkFakeBank, makeMember, plain, removeMember, sayJointUse, waitForSync, watch } from "./helpers.ts";

// The figure that opens its rows ("Näytä tapahtumat: …"): the panel lists the rows the figure adds up, they sum to the figure the page shows,
// and its foot says "Täsmää". A row of a joint account shows the bank's whole sum beside the part it counts. The first test
// reads the administrator's demo household and changes nothing; the second makes two members and removes them.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const SHOTS = process.env.SHOTS_DIR;

test.describe.configure({ mode: "serial" });

async function ready(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
}

/** The panel of the figure named by the opener's label, opened. */
async function openPanel(page: Page, title: string) {
  await page.getByRole("button", { name: `Näytä tapahtumat: ${title}` }).click();
  const panel = page.getByRole("dialog", { name: title });
  await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return panel;
}

/** What the rows of the panel add up to, in cents, after "Näytä kaikki" when the list is cut at 50. */
async function rowsSum(panel: ReturnType<Page["getByRole"]>): Promise<number> {
  const more = panel.getByRole("button", { name: "Näytä kaikki" });
  if (await more.count()) await more.click();
  const texts = await panel.locator("tr[data-why-row] td.num").allInnerTexts();
  return texts.reduce((sum, t) => sum + cents(t), 0);
}

test("a category of the month opens its rows, they add up to the figure and the foot says Täsmää", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  // Kuukausi lists the month's categories, each sum a door to its rows (Rahankäyttö opens a category in place and has no panel)
  await ready(page, "/#/reports");
  await expect(page.locator(".km .km-total")).toContainText(/Menot\s[\d\s]+€/, { timeout: 15_000 });
  // the first figure that opens its rows and has some: its label names the figure, the panel's total is what the rows add up to
  const opener = page.getByRole("button", { name: /^Näytä tapahtumat: / }).filter({ hasNotText: /^0,00/ }).first();
  await expect(opener).toBeVisible();
  await opener.click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const title = (await panel.getByRole("heading").first().innerText()).trim();
  expect(await panel.locator("tr[data-why-row]").count()).toBeGreaterThan(0);
  expect(await rowsSum(panel)).toBe(cents(await panel.locator("[data-why-total]").innerText()));
  await expect(panel.getByRole("status").filter({ hasText: "Täsmää" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "explain-1280-top.png") });
  // only rows that count stand in the list, each named with its payee's mark; one category is said once, by the title, so
  // the table has no category column; the rows left out wait in one closed group
  for (const t of await panel.locator("tr[data-why-row] td.num").allInnerTexts()) expect(cents(t)).not.toBe(0);
  expect(await panel.locator("tr[data-why-row] .tc-mark").count()).toBe(await panel.locator("tr[data-why-row]").count());
  await expect(panel.locator("table.why-rows").first().locator("thead th")).toHaveText(["Päivä", "Saaja", "Summa"]);
  const group = panel.locator("details.why-left");
  if (await group.count()) {
    await expect(group).not.toHaveAttribute("open", "");
    await expect(group.locator("summary")).toHaveText(/^Ei laskettu mukaan: (1 tapahtuma|\d+ tapahtumaa)$/);
    await group.locator("summary").click();
    for (const t of await group.locator("tr[data-why-left] td.num").allInnerTexts()) expect(cents(t)).toBe(0);
  }
  // the heading and the foot stay in view while the list scrolls
  await panel.locator(".why-scroll").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(panel.getByRole("heading", { name: title })).toBeInViewport();
  await expect(panel.getByRole("status").filter({ hasText: "Täsmää" })).toBeInViewport();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "explain-1280-foot.png") });
  // the keyboard closes it, and the opener is reachable again
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 800 });
  await openPanel(page, title);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "explain-390.png") });
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Yhteenveto: the month's spending opens its rows, and they add up to the panel's total", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await ready(page, "/#/overview");
  const tile = page.locator("[data-tile=spent] button.why-door");
  await expect(tile).toHaveCount(1);
  // the tile shows whole euros, the panel the cents of its rows
  const figure = cents(await page.locator("[data-tile=spent] .fig").innerText());
  await tile.click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const sum = await rowsSum(panel);
  expect(sum).toBe(cents(await panel.locator("[data-why-total]").innerText()));
  expect(Math.round(sum / 100) * 100).toBe(figure);
  await expect(panel.getByRole("status").filter({ hasText: "Täsmää" })).toBeVisible();
  await context.close();
});

test.describe("a joint account", () => {
  const NAMES = ["e2e-miksi-a", "e2e-miksi-b"] as const;
  const members: { state: string; id: string }[] = [];

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
        // cut by who paid, so the rows are told by the trace and not by the weights
        const meta = await (await first.request.get("/api/meta")).json();
        const joint = (meta.accounts as { id: string; name: string }[]).find((a) => a.name === "Yhteistili")!;
        const split = await first.request.put(`/api/accounts/${encodeURIComponent(joint.id)}/split`, { data: { mode: "source" }, headers: { "X-Requested-With": "fetch" } });
        expect(split.ok(), `PUT split answered ${split.status()} ${await split.text()}`).toBe(true);
        await first.close();
      }
      await context.close();
    }
  });
  test.afterAll(async ({ browser }) => {
    for (const member of members) await removeMember(browser, member.id);
  });

  test("a row of the joint account shows the bank's whole sum beside its part, and the rows still add up", async ({ browser }) => {
    const context = await browser.newContext({ storageState: members[0]!.state, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
        const wide = await (await context.request.get("/api/explain?figure=spend.month&from=2000-01-01&to=2099-12-31")).json();
    expect(wide.lines.some((l: { whole?: number; cents: number }) => l.whole !== undefined && l.whole !== l.cents), JSON.stringify(wide.lines.slice(0, 3))).toBe(true);
    expect(wide.check.diffCents).toBe(0);
    // Kuukausi of the month before, whole: a category of it opens the rows of the whole month, the joint account's among them
    const { today } = (await (await context.request.get("/api/meta")).json()) as { today: string };
    const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    const month = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    await ready(page, `/#/reports?month=${month}`);
    await expect(page.locator(".km .km-total")).toContainText(/Menot\s[\d\s]+€/, { timeout: 15_000 });
    const doors = page.getByRole("button", { name: /^Näytä tapahtumat: / }).filter({ hasNotText: /^0,00/ });
    const count = await doors.count();
    expect(count).toBeGreaterThan(0);
    // the categories that hold a row of the joint account say the bank's whole sum; every panel adds up to its door
    let told = 0;
    for (let i = 0; i < count; i++) {
      const figure = cents(await doors.nth(i).innerText());
      await doors.nth(i).click();
      const panel = page.getByRole("dialog");
      await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
      if (plain(await panel.innerText()).includes("Tapahtuman summa")) told++;
      expect(await rowsSum(panel), `category ${i + 1}`).toBe(figure);
      await expect(panel.getByRole("status").filter({ hasText: "Täsmää" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
    }
    expect(told, "a panel says the bank's whole sum of a joint row").toBeGreaterThan(0);
    await context.close();
  });

  test("the part a row of Tapahtumat tells is the Yhteensä of the panel it opens", async ({ browser }) => {
    const context = await browser.newContext({ storageState: members[0]!.state, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await ready(page, "/#/transactions");
    const row = page.locator("table.tx-table tbody tr:not(.rt-detail)").filter({ has: page.locator('.tx-part:text-matches("^koko summa")') }).first();
    await expect(row).toBeVisible();
    const told = cents(await row.locator(".tx-amount").innerText());
    await row.locator(".rt-drill").click();
    await page.locator(".tx-detail-acts .why-door").click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    expect(cents(await panel.locator("[data-why-total]").innerText())).toBe(told);
    // the pool is cut by who paid: every row with a part is explained by the part it shows, and some say whose money it was.
    // The newest 120 rows hold about 40 with a part, most of them cut by who paid; all 500 asked one by one took over the
    // 60 s of a test on a loaded machine
    const listed = (await (await context.request.get("/api/transactions?limit=120")).json()).items as { id: string; partCents?: number }[];
    const sources: boolean[] = [];
    for (const t of listed.filter((x) => x.partCents !== undefined)) {
      const e = await (await context.request.get(`/api/explain?figure=share.part&row=${t.id}&from=2000-01-01&to=2099-12-31`)).json();
      expect(e.cents, t.id).toBe(t.partCents);
      sources.push(e.lines.some((l: { why: { rule: string }[] }) => l.why.some((w) => w.rule === "part.source")));
    }
    expect(sources.length).toBeGreaterThan(0);
    expect(sources, "the trace told the parts").toContain(true);
    await context.close();
  });
});

// The usual income had a door in the Tulot section of Raportit, which the Yhteenveto redesign took away with the rest of
// the page's figures (a00c24945, #67); no page opens it now, so the answer is read from the API.
test.describe("figures that are not a sum of one range", () => {
  test("the usual income is a median of its months, each month's rows add up to its figure, and the check recomputes it", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE });
    const e = await (await context.request.get("/api/explain?figure=usual.income&from=2025-12-01&to=2026-11-13")).json();
    expect(e.kind).toBe("median");
    expect(e.check).toEqual({ kind: "recompute", diffCents: 0 });
    expect(e.method.values.length).toBeGreaterThanOrEqual(3);
    for (const v of e.method.values as { label: string; cents: number; explain?: { cents: number; check: { diffCents: number } } }[]) {
      expect(v.explain?.cents, v.label).toBe(v.cents);
      expect(v.explain?.check.diffCents, v.label).toBe(0);
    }
    await context.close();
  });
});
