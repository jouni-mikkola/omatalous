import { expect, test, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";

// High contrast (forced-colors: active) paints every background in the theme's colours and drops each box-shadow, and
// the pressed key of a .segmented and the chosen tab of .tabs were told by those two alone. forced-colors.css draws
// the choice with a border or an outline in a system colour: here the chosen one's differs from every sibling's, and
// the focus ring can be seen on the chosen one and on one beside it.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const CHOSEN = '[aria-pressed="true"], [aria-selected="true"], [aria-current="page"]';

interface Drawn {
  /** The border and the outline as the browser computed them, in one line. */
  edge: string;
  outlineStyle: string;
  outlineWidth: number;
  outlineColor: string;
  background: string;
  /** The colour the page is painted on (the system colour Canvas). */
  canvas: string;
  focusVisible: boolean;
}

const drawn = (el: Locator): Promise<Drawn> =>
  el.evaluate((node) => {
    const s = getComputedStyle(node);
    const probe = document.createElement("span");
    probe.style.color = "Canvas";
    document.body.append(probe);
    const canvas = getComputedStyle(probe).color;
    probe.remove();
    const sides = ["top", "right", "bottom", "left"].map((side) => `${s.getPropertyValue(`border-${side}-width`)} ${s.getPropertyValue(`border-${side}-style`)} ${s.getPropertyValue(`border-${side}-color`)}`);
    return {
      edge: `border ${sides.join(", ")}; outline ${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor} ${s.outlineOffset}`,
      outlineStyle: s.outlineStyle,
      outlineWidth: parseFloat(s.outlineWidth),
      outlineColor: s.outlineColor,
      background: s.backgroundColor,
      canvas,
      focusVisible: node.matches(":focus-visible"),
    };
  });

/** The focus ring of `el`, which must be there, at least 2 px wide and in a colour that is neither the page's nor the element's own. */
async function focusSeen(page: Page, el: Locator, what: string): Promise<void> {
  const before = await drawn(el);
  // the keyboard was used last, so the focus that follows is one the browser shows (:focus-visible)
  await page.keyboard.press("Tab");
  await el.focus();
  const now = await drawn(el);
  expect(now.focusVisible, `${what}: :focus-visible`).toBe(true);
  expect(now.outlineStyle, `${what}: outline style`).toBe("solid");
  expect(now.outlineWidth, `${what}: outline width`).toBeGreaterThanOrEqual(2);
  expect(now.outlineColor, `${what}: outline against the page`).not.toBe(now.canvas);
  expect(now.outlineColor, `${what}: outline against its own background`).not.toBe(now.background);
  expect(now.edge, `${what}: focused against not focused`).not.toBe(before.edge);
  await el.blur();
}

/** Every visible row of choices of `kind` on the page: the chosen one is drawn unlike each sibling, and the focus shows. Returns how many rows had a chosen one. */
async function choices(page: Page, kind: ".segmented" | ".tabs", what: string): Promise<number> {
  let rows = 0;
  for (const row of await page.locator(kind).filter({ visible: true }).all()) {
    const items = row.locator("button, a").filter({ visible: true });
    const chosen = items.and(page.locator(CHOSEN));
    if ((await chosen.count()) === 0) continue;
    rows++;
    const name = `${what}, ${kind} "${(await row.getAttribute("aria-label")) ?? ""}"`;
    await expect(chosen, name).toHaveCount(1);
    const mark = await drawn(chosen);
    const siblings = await items.and(page.locator(`:not(${CHOSEN})`)).all();
    expect(siblings.length, `${name}: siblings`).toBeGreaterThan(0);
    for (const sibling of siblings) expect((await drawn(sibling)).edge, `${name}: "${await sibling.textContent()}" against the chosen one`).not.toBe(mark.edge);
    await focusSeen(page, chosen, `${name}: the chosen one`);
    // a key that is off takes no focus
    for (const sibling of siblings) {
      if (!(await sibling.isEnabled())) continue;
      await focusSeen(page, sibling, `${name}: one beside the chosen one`);
      break;
    }
  }
  return rows;
}

for (const width of [390, 1440]) {
  // Menot kategorioittain has the period's row of keys (3 kk, 6 kk, 12 kk ...)
  for (const [name, path, kind] of [
    ["Raportit", "/#/reports?q=menot", ".segmented"],
    ["Asetukset", "/#/settings", ".tabs"],
  ] as const) {
    test(`${name} at ${width} px in high contrast: the chosen one and the focus can be told`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, forcedColors: "active" });
      const page = await context.newPage();
      await page.goto(path);
      await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator(kind).filter({ visible: true }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), "forced colours are on").toBe(true);
      // the page's own row of choices is there, and every other row on the page (the top bar's) is held to the same
      expect(await choices(page, kind, `${name} at ${width} px`), `${name}: a ${kind} with a chosen one`).toBeGreaterThan(0);
      await choices(page, kind === ".tabs" ? ".segmented" : ".tabs", `${name} at ${width} px`);
      await context.close();
    });
  }

  // The kinds of a figure (Nyt, Arvio, Tavallinen) and an estimated sum (Summa arvioitu) were told by a fill, a colour and a dotted
  // line: with the colours taken the word and the edge still differ.
  test(`Laskut at ${width} px in high contrast: each kind's chip differs by its word and edge, and an estimated sum keeps its dotted line`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, forcedColors: "active" });
    const page = await context.newPage();
    await page.goto("/#/bills");
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator("#laskut-taulukko .bill-month").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), "forced colours are on").toBe(true);
    // every month open, so the estimated pays of the later months are among the rows
    const closed = page.locator("#laskut-taulukko .bill-month[aria-expanded=false]");
    while ((await closed.count()) > 0) await closed.first().click();

    // the three chips of the cards at the head: Nyt, Arvio, Tavallinen
    const chips = page.locator(".kind-cards .kind-chip");
    await expect(chips).toHaveText(["Nyt", "Arvio", "Tavallinen"]);
    const edges = await chips.evaluateAll((els) => els.map((el) => `${getComputedStyle(el).outlineStyle} ${getComputedStyle(el).outlineWidth}`));
    expect(new Set(edges).size, `edges of the three chips: ${edges.join(" | ")}`).toBeGreaterThanOrEqual(2);
    expect(edges[0], "Nyt has a solid edge").toMatch(/^solid [1-9]/);
    expect(edges[1], "Arvio has a dashed edge").toMatch(/^dashed [1-9]/);
    expect(edges[0], "Nyt against Arvio").not.toBe(edges[1]);

    // the chip of the table's totals and of the later months' names is the same Arvio
    const inTable = page.locator("#laskut-taulukko .kind-chip-estimate");
    expect(await inTable.count(), "Arvio chips in the table").toBeGreaterThan(1);
    for (const style of await inTable.evaluateAll((els) => els.map((el) => getComputedStyle(el).outlineStyle))) expect(style, "Arvio chip in the table").toBe("dashed");

    // the sum of an estimated bill: underlined with a dotted line, which a plain cell is not
    const estimated = page.locator("#laskut-taulukko .fig-est");
    expect(await estimated.count(), "estimated marks in the table").toBeGreaterThan(0);
    const line = await estimated.first().evaluate((el) => ({ line: getComputedStyle(el).textDecorationLine, style: getComputedStyle(el).textDecorationStyle }));
    expect(line.line, "the mark of an estimate").toContain("underline");
    expect(line.style, "the mark of an estimate").toBe("dotted");
    const plain = await page.locator("#laskut-taulukko tbody td").first().evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(plain, "a plain cell").not.toContain("underline");
    await context.close();
  });

  // The bills chart told paid from coming by a fill and a hatch in role colours: with the colours taken the paid part stays
  // filled, the part to come keeps its dashed edge and its hatch lines, and the rule at today stays drawn.
  test(`Laskut at ${width} px in high contrast: the chart's coming parts keep a dashed edge and a hatch, the paid ones a fill`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, forcedColors: "active" });
    const page = await context.newPage();
    await page.goto("/#/bills");
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".month-columns rect.ms-coming").first()).toBeVisible();
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), "forced colours are on").toBe(true);
    const style = (selector: string) =>
      page.locator(selector).first().evaluate((el) => {
        const s = getComputedStyle(el);
        const probe = document.createElement("span");
        probe.style.color = "CanvasText";
        document.body.append(probe);
        const ink = getComputedStyle(probe).color;
        probe.remove();
        return { fill: s.fill, stroke: s.stroke, strokeWidth: Number.parseFloat(s.strokeWidth), dash: s.strokeDasharray, ink };
      });
    const coming = await style(".month-columns rect.ms-coming");
    expect(coming.dash, "dashed edge of a coming part").not.toBe("none");
    expect(coming.strokeWidth, "edge of a coming part").toBeGreaterThanOrEqual(1);
    expect(coming.stroke, "edge of a coming part is the text colour").toBe(coming.ink);
    expect(coming.fill, "the hatch").toMatch(/^url\(/);
    const hatch = await style(".month-columns line.ms-hatch");
    expect(hatch.stroke, "hatch lines are the text colour").toBe(hatch.ink);
    const rule = await style(".month-columns line.ms-today");
    expect(rule.stroke, "the rule at today").toBe(rule.ink);
    // the part already paid, when the month has one, is a solid fill, not an outline
    if ((await page.locator(".month-columns rect.ms-s0:not(.ms-coming)").count()) > 0) {
      const paid = await style(".month-columns rect.ms-s0:not(.ms-coming)");
      expect(paid.fill, "a paid part is filled").toBe(paid.ink);
      expect(paid.dash, "a paid part has no dashed edge").toBe("none");
    }
    await context.close();
  });
}
