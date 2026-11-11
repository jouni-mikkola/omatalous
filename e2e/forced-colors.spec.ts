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
  // Kuukausi's first view (the month) has no row of keys: its question Menot has the period's (3 kk, 6 kk, 12 kk ...)
  for (const [name, path, kind] of [
    ["Kuukausi", "/#/reports?q=menot", ".segmented"],
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
}
