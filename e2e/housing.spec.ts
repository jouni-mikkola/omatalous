import { type Browser, expect, type Locator, test } from "@playwright/test";
import { linkFakeBank, makeMember, overflow, removeMember, sayJointUse, waitForSync, watch } from "./helpers.ts";

// The question about a home loan, Onko taloudessa asuntolaina?, which Tarkistettavat asks. The block Asuminen of Raportit
// that showed the rent, the electricity and the loans left with the extra report sections (6fbd30df7), so what is left
// here is the question. It needs a household that is no tenant: two members who link the fake bank (e2e/fake-bank/)
// have electricity and a joint account whose payments no category calls a mortgage. They are made here and go at the end.
const FETCH = { "X-Requested-With": "fetch" };
const NAMES = ["e2e-asuminen-a", "e2e-asuminen-b"] as const;

interface Member {
  state: string;
  id: string;
}
const members: Member[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  for (const name of NAMES) {
    const member = await makeMember(browser, name);
    members.push(member);
    const context = await browser.newContext({ storageState: member.state });
    await linkFakeBank(await context.newPage());
    await waitForSync(context);
    await context.close();
  }
  // the first partner says who uses the joint account, as Asetukset > Tilit does; both copies are one real account
  const first = await browser.newContext({ storageState: members[0]!.state });
  await sayJointUse(first, members.map((m, i) => ({ userId: m.id, weight: [6000, 4000][i]! })));
  await first.close();
});
test.afterAll(async ({ browser }) => {
  for (const member of members) await removeMember(browser, member.id);
});

const addLink = (block: Locator) => block.getByRole("link", { name: "Lisää asuntolaina", exact: true });
const answerButton = (block: Locator) => block.getByRole("button", { name: "Ei asuntolainaa", exact: true });

const ANSWER = { subject: "question:mortgage", mark: "dismissed" };

/**
 * Tarkistettavat with the mortgage question alone: the server still decides whether it is asked, and the other items of
 * the queue, which come first, are left out so the question is the one on screen.
 */
async function openQuestion(browser: Browser, state: string, width = 1280) {
  const context = await browser.newContext({ storageState: state, viewport: { width, height: 900 } });
  await context.route(/\/api\/review(\?|$)/, async (route) => {
    // a request the page leaves behind on its way to Asetukset may be gone before its answer is read
    try {
      const response = await route.fetch();
      const json = await response.json();
      await route.fulfill({ response, json: { ...json, items: json.items.filter((i: { kind: string }) => i.kind === "mortgage") } });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/review");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return { context, page, seen, card: page.locator(".review-item") };
}

test("Tarkistettavat asks it: Onko taloudessa asuntolaina? with the link to the card Lainat of Asetukset; at 390 px nothing scrolls sideways", async ({ browser }) => {
  for (const width of [1280, 390]) {
    const { context, page, seen, card } = await openQuestion(browser, members[0]!.state, width);
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("Onko taloudessa asuntolaina?");
    await expect(card.locator(".review-kind")).toHaveText("Asuminen");
    await expect(addLink(card)).toHaveAttribute("href", "#/settings/household#lainat");
    await expect(answerButton(card)).toBeEnabled();
    expect(await overflow(page), `Tarkistettavat scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
    const box = (await card.boundingBox())!;
    for (const control of [addLink(card), answerButton(card)]) {
      const c = (await control.boundingBox())!;
      expect(c.x + c.width, "a control stays inside the card").toBeLessThanOrEqual(box.x + box.width);
    }
    if (width === 1280) {
      await addLink(card).click();
      await expect(page).toHaveURL(/#\/settings\/household#lainat$/);
      await expect(page.locator("#lainat").getByRole("heading", { name: "Lainat", exact: true })).toBeVisible();
    }
    expect(seen.problems).toEqual([]);
    await context.close();
  }
});

test("Ei asuntolainaa stores the mark the first page stored, holds the button while it is on its way, and the question stays away after a reload", async ({ browser }) => {
  const { context, page, seen, card } = await openQuestion(browser, members[0]!.state);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/marks$/, async (route) => {
    if (route.request().method() === "PUT") await held;
    await route.continue().catch(() => {});
  });
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/marks") && r.method() === "PUT");
  await answerButton(card).click();
  expect((await sent).postDataJSON()).toEqual(ANSWER);
  await expect(answerButton(card)).toBeDisabled();
  release();
  await expect(page.getByRole("heading", { name: "Onko taloudessa asuntolaina?" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Onko taloudessa asuntolaina?" })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the answer is the member's own: the other member is asked still, and an answer that is not saved leaves the question", async ({ browser }) => {
  // the 500 below is the point of the test, so only it may be a problem
  const { context, page, seen, card } = await openQuestion(browser, members[1]!.state);
  await expect(answerButton(card)).toBeVisible();
  await page.route(/\/api\/marks$/, (route) => (route.request().method() === "PUT" ? route.fulfill({ status: 500, json: { error: "Palvelinvirhe." } }) : route.continue()));
  await answerButton(card).click();
  await expect(card.getByRole("alert")).toBeVisible();
  await expect(answerButton(card)).toBeEnabled();
  expect(seen.problems.every((p) => /500|Failed to load resource/.test(p))).toBe(true);
  // the marks of the member are untouched by the first member's answer
  const marks = (await (await context.request.get("/api/recurring")).json()).marks as { subject: string }[];
  expect(marks.some((x) => x.subject === ANSWER.subject)).toBe(false);
  await context.close();
});

test("with nothing of a home left the question waits in Tarkistettavat", async ({ browser }) => {
  const context = await browser.newContext({ storageState: members[1]!.state });
  // the electricity is called cancelled, as the marks route takes it: nothing of a home is known
  const housing = (await (await context.request.get("/api/reports?reports=housing")).json()).housing as { charges: { seriesId: string }[] };
  for (const charge of housing.charges) {
    const marked = await context.request.put("/api/marks", { headers: FETCH, data: { subject: `series:${charge.seriesId}`, mark: "cancelled" } });
    expect(marked.ok(), `PUT /api/marks answered ${marked.status()}`).toBe(true);
  }
  const items = (await (await context.request.get("/api/review")).json()).items as { kind: string }[];
  expect(items.some((i) => i.kind === "mortgage")).toBe(true);
  await context.close();
});
