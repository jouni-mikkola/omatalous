import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, linkFakeBank, makeMember, plain, removeMember, sayJointUse, waitForSync, watch } from "./helpers.ts";

// The figure that opens its rows ("Näytä rivit: …"): the panel lists the rows the figure adds up, they sum to the figure the page shows,
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
  await page.getByRole("button", { name: `Näytä rivit: ${title}` }).click();
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

test("the month's spending opens its rows, they add up to the figure and the foot says Täsmää", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await ready(page, "/#/overview?period=last-month");
  const row = page.locator(".month-table tbody tr", { has: page.getByRole("link", { name: "Menot", exact: true }) });
  const figure = cents(await row.locator("td.st-num").first().innerText());
  const panel = await openPanel(page, "Menot");
  expect(await panel.locator("tr[data-why-row]").count()).toBeGreaterThan(0);
  expect(await rowsSum(panel)).toBe(figure);
  expect(cents(await panel.locator("[data-why-total]").innerText())).toBe(figure);
  await expect(panel.getByRole("status").filter({ hasText: "Täsmää" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "explain-1280-top.png") });
  // only rows that count stand in the list, each with its category; the rows left out wait in one closed group
  for (const t of await panel.locator("tr[data-why-row] td.num").allInnerTexts()) expect(cents(t)).not.toBe(0);
  expect(await panel.locator("tr[data-why-row] + tr.why-more").count()).toBeGreaterThan(0);
  const group = panel.locator("details.why-left");
  if (await group.count()) {
    await expect(group).not.toHaveAttribute("open", "");
    await expect(group.locator("summary")).toHaveText(/^Ei laskettu mukaan: (1 tapahtuma|\d+ tapahtumaa)$/);
    await group.locator("summary").click();
    for (const t of await group.locator("tr[data-why-left] td.num").allInnerTexts()) expect(cents(t)).toBe(0);
  }
  // the heading and the foot stay in view while the list scrolls
  await panel.locator(".why-scroll").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(panel.getByRole("heading", { name: "Menot" })).toBeInViewport();
  await expect(panel.getByRole("status").filter({ hasText: "Täsmää" })).toBeInViewport();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "explain-1280-foot.png") });
  // the keyboard closes it, and the opener is reachable again
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 800 });
  await openPanel(page, "Menot");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "explain-390.png") });
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Raportit: a category and the total open their rows, each adding up to its figure", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await ready(page, "/#/reports?period=12m");
  const body = page.locator("section", { has: page.getByRole("heading", { name: "Kategoriat" }) });
  const first = body.locator("tbody tr:not(.group-row)").first();
  const figure = cents(await first.locator("td.num").first().innerText());
  await first.getByRole("button", { name: /Näytä rivit/ }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  // Raportit prints whole euros: the rows' sum rounds to the figure printed
  expect(Math.round((await rowsSum(panel)) / 100)).toBe(figure / 100);
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
    await ready(page, "/#/reports?period=12m");
    const total = page.locator("tfoot tr.foot-row", { hasText: "Yhteensä" }).first();
    const figure = cents(await total.locator("td.num").first().innerText());
    await total.getByRole("button", { name: /Näytä rivit/ }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    expect(plain(await panel.innerText())).toContain("Tapahtuman summa");
    expect(Math.round((await rowsSum(panel)) / 100)).toBe(figure / 100);
    await expect(panel.getByRole("status").filter({ hasText: "Täsmää" })).toBeVisible();
    await context.close();
  });

  test("the part a row of Tapahtumat tells is the Yhteensä of the panel it opens", async ({ browser }) => {
    const context = await browser.newContext({ storageState: members[0]!.state, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await ready(page, "/#/transactions");
    const row = page.locator("table tbody tr").filter({ has: page.locator(".tx-part button") }).first();
    await expect(row).toBeVisible();
    const told = cents((await row.locator(".tx-part button").innerText()).replace("osuutesi", ""));
    await row.locator(".tx-part button").click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    expect(cents(await panel.locator("[data-why-total]").innerText())).toBe(told);
    // the pool is cut by who paid: every row with a part is explained by the part it shows, and some say whose money it was
    const listed = (await (await context.request.get("/api/transactions?limit=500")).json()).items as { id: string; partCents?: number }[];
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

/** The opened panel at both widths, for the pictures. */
async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: join(SHOTS, `${name}-1280.png`) });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: join(SHOTS, `${name}-390.png`) });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test.describe("figures that are not a sum of one range", () => {
  test("the usual income opens its months, a month opens its rows, and no Täsmää is said", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await ready(page, "/#/reports?period=12m");
    const usual = page.getByRole("button", { name: "Näytä rivit: Säännölliset tulot kuukaudessa" });
    await usual.scrollIntoViewIfNeeded();
    const figure = cents(await page.locator(".kv > div", { has: usual }).locator(".v").innerText());
    await usual.click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    const months = panel.locator("details.why-month");
    expect(await months.count()).toBeGreaterThanOrEqual(3);
    expect(Math.round(cents(await panel.locator("[data-why-total]").innerText()) / 100)).toBe(figure / 100);
    await months.last().locator("summary").click();
    await expect(months.last().locator("tr[data-why-row]").first()).toBeVisible();
    await expect(panel.getByText("Täsmää")).toHaveCount(0);
    await shoot(page, "median");
    await context.close();
  });
});
