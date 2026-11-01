import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createMember, removeMember, watch } from "./helpers.ts";

// axe-core over the four pages of the main menu: no violation of impact serious or critical.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
// the page's policy refuses a script it did not serve, so axe is added to a context that bypasses it
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: unknown[]; any: { message: string }[] }[];
}

/** The serious and critical violations on the page as it stands, one line each with the first targets. */
async function serious(page: Page, floor: ("serious" | "critical" | "moderate" | "minor")[] = ["serious", "critical"]): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  // a card that refetches is dimmed (.loading, 0.6 opacity) and axe would read its colours dimmed: wait for the last one to settle
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
  // a card fades in: its colours are read at the end of that, not in the middle of it
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* one that never ends */ } }));
  const found = await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: Violation[] }> } }).axe.run;
    return (await run(document, { resultTypes: ["violations"] })).violations;
  });
  return found.filter((v) => floor.includes(v.impact as "serious")).map((v) => `${v.id} (${v.impact}): ${v.help}: ${v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} [${n.any[0]?.message ?? ""}]`).join(" | ")}`);
}

async function visit(context: BrowserContext, path: string, ready: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(ready).first()).toBeVisible();
  // a card that refetches is dimmed (.loading, base.css): its colours are read once it has settled
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
  return page;
}

for (const [name, path, ready] of [
  ["Yhteenveto", "/#/overview", ".home-answer-line"],
  ["Raportit", "/#/reports", ".q-frame"],
  ["Tapahtumat", "/#/transactions", ".tx-card"],
  ["Asetukset", "/#/settings", "h1, h2"],
] as const) {
  test(`${name}: axe finds no serious or critical violation`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 }, bypassCSP: true });
    const page = await visit(context, path, ready);
    const seen = watch(page);
    expect(await serious(page)).toEqual([]);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

// 0.69: the pages of the round's UI5, at the desktop and the phone width. Tarkistettavat is looked at with
// a question on it and with the queue empty.
const LOAN = { kind: "loan", id: "loan:a11y", cents: 120_000, key: "a11y", payee: "Pankki Oyj", paymentCents: 10_000, months: 12, firstDate: "2025-01-02", lastDate: "2025-12-02", guess: "mortgage", placed: true, rows: [], rowCount: 12 };
for (const width of [1280, 390]) {
  for (const [name, path, ready, queue] of [
    ["Yhteenveto", "/#/overview", ".home-answer-line", null],
    ["Laskut", "/#/bills", "#tulossa", null],
    ["Tapahtumat", "/#/transactions", ".tx-card", null],
    ["Tarkistettavat, a question", "/#/review", ".review-item", [LOAN]],
    ["Tarkistettavat, empty", "/#/review", ".review-end", []],
  ] as const) {
    test(`${name}, ${width} px: axe finds no serious or critical violation`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
      if (queue) await context.route(/\/api\/review(\?|$)/, (r) => r.fulfill({ json: { items: queue } }));
      const page = await visit(context, path, ready);
      const seen = watch(page);
      expect(await serious(page)).toEqual([]);
      expect(seen.problems).toEqual([]);
      await context.close();
    });
  }
}

// 0.69.1: three rules the serious-only checks above let through, on the pages that had them: a control's name holds its visible
// text, a landmark is told apart from its twin, a table head cell is not empty. Any impact counts here.
const ROWS = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, date: `2025-0${i + 1}-02`, cents: -10_000, name: "Pankki Oyj", text: "LAINA" }));
const MANY = { ...LOAN, rows: ROWS, rowCount: 5 };
const RULES = ["label-content-name-mismatch", "landmark-unique", "empty-table-header"];
for (const width of [1440, 390]) {
  for (const [name, path, ready, queue] of [
    ["Yhteenveto", "/#/overview", ".home-answer-line", null],
    ["Säästövinkit", "/#/optimise", ".tip-figure", null],
    ["Tarkistettavat", "/#/review", ".review-figure", [MANY]],
    ["Tapahtumat", "/#/transactions", ".rtb", null],
    ["Asetukset", "/#/settings/members", "table:has(caption:text-is(\"Talouden jäsenet\"))", null],
  ] as const) {
    test(`${name}, ${width} px: axe finds no mismatched name, repeated landmark or empty table header`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
      if (queue) await context.route(/\/api\/review(\?|$)/, (r) => r.fulfill({ json: { items: queue } }));
      const page = await visit(context, path, ready);
      await page.addScriptTag({ path: AXE });
      const found = await page.evaluate(async (rules) => {
        const run = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: Violation[] }> } }).axe.run;
        return (await run(document, { runOnly: { type: "rule", values: rules }, resultTypes: ["violations"] })).violations;
      }, RULES);
      expect(found.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} [${n.any[0]?.message ?? ""}]`).join(" | ")}`)).toEqual([]);
      await context.close();
    });
  }
}

// S10: the sign-in and the first-run wizard, any impact, at the phone and the desktop width. The sign-in is a context nobody is
// signed in in. The wizard is the administrator's page with the server's answer that the setup is not finished.
const EVERY = ["critical", "serious", "moderate", "minor"] as const;
for (const width of [390, 1440]) {
  const phone = width < 600 ? { isMobile: true, hasTouch: true } : {};
  test(`Kirjautuminen, ${width} px: axe finds no violation`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, bypassCSP: true, ...phone });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();
    expect(await serious(page, [...EVERY])).toEqual([]);
    // the failed sign-in notice is part of the page too
    await page.getByLabel("Käyttäjätunnus").fill("ei-ole");
    await page.getByLabel("Salasana").fill("väärä-salasana-123");
    await page.getByRole("button", { name: "Kirjaudu sisään" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await serious(page, [...EVERY])).toEqual([]);
    expect(seen.problems.filter((p) => !/\b40[01]\b/.test(p))).toEqual([]);
    await context.close();
  });

  test(`Ohjattu aloitus, ${width} px: axe finds no violation`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...phone });
    await context.route(/\/api\/meta(\?|$)/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), setupDone: false } });
    });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Käyttöönotto" })).toBeVisible();
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".setup-steps")).toBeVisible();
    expect(await serious(page, [...EVERY])).toEqual([]);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

// S14, the Version 1.0 check: every route of the app at the phone and the desktop width. axe finds nothing serious or critical,
// the headings are in order, every control is big enough to touch and the focus can be seen. The routes are the ones
// table-views.spec.ts walks, with the reports' other questions.
const ROUTES = [
  "/#/overview",
  "/#/bills",
  "/#/transactions",
  "/#/transactions?view=merchants",
  "/#/reports",
  "/#/reports?q=tulot",
  "/#/reports?q=menot",
  "/#/reports?q=saldot",
  "/#/reports?q=kiinteat",
  "/#/reports?q=velat",
  "/#/reports?q=kuukausi",
  "/#/reports?q=yhteiset",
  "/#/optimise",
  "/#/review",
  "/#/settings/banks",
  "/#/settings/household",
  "/#/settings/members",
  "/#/settings/security",
  "/#/settings/data",
  "/#/settings/server",
];

/** Opens each route in turn in one context and runs `check` on it; the problems come back one line each, with the route. */
async function everyRoute(browser: import("@playwright/test").Browser, width: number, check: (page: Page, route: string) => Promise<string[]>): Promise<string[]> {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  const problems: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    // a hash-only navigation keeps the old document: reload so the page is read from the start
    await page.reload();
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator("main h1, main h2").first()).toBeVisible();
    problems.push(...(await check(page, route)).map((p) => `${route}: ${p}`));
  }
  await context.close();
  return problems;
}

for (const width of [390, 1440]) {
  test(`every route, ${width} px: axe finds no serious or critical violation`, async ({ browser }) => {
    test.setTimeout(240_000);
    expect(await everyRoute(browser, width, (page) => serious(page))).toEqual([]);
  });

  test(`every route, ${width} px: the headings are in order`, async ({ browser }) => {
    test.setTimeout(240_000);
    expect(
      await everyRoute(browser, width, (page) =>
        page.evaluate(() => {
          const shown = (el: Element) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true });
          const levels = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")).filter(shown).map((el) => ({
            level: el.getAttribute("aria-level") ? Number(el.getAttribute("aria-level")) : Number(el.tagName.slice(1)) || 2,
            text: (el.textContent ?? "").trim().slice(0, 40),
          }));
          const out: string[] = [];
          const ones = levels.filter((h) => h.level === 1);
          if (ones.length !== 1) out.push(`${ones.length} h1 headings`);
          if (levels[0] && levels[0].level !== 1) out.push(`first heading is h${levels[0].level} "${levels[0].text}"`);
          levels.forEach((h, i) => {
            if (i > 0 && h.level > levels[i - 1]!.level + 1) out.push(`h${levels[i - 1]!.level} then h${h.level} "${h.text}"`);
          });
          return out;
        }),
      ),
    ).toEqual([]);
  });

  test(`every route, ${width} px: the focus can be seen`, async ({ browser }) => {
    test.setTimeout(240_000);
    expect(
      await everyRoute(browser, width, async (page) => {
        const out: string[] = [];
        await page.locator("body").click({ position: { x: 1, y: 1 } });
        for (let i = 0; i < 60; i++) {
          await page.keyboard.press("Tab");
          const seen = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return null;
            const s = getComputedStyle(el);
            const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2;
            const ring = s.boxShadow !== "none" && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(s.boxShadow);
            // the hit area of a chart is an SVG shape that draws its mark as a stroke
            // a date field marks the segment being edited itself: the browser's own mark, which the input does not match :focus-visible for
            const own = (el as HTMLInputElement).type === "date";
            const stroke = el instanceof SVGElement && s.stroke !== "none" && parseFloat(s.strokeWidth) > 0;
            const r = el.getBoundingClientRect();
            // the ring of a control in the top bar or the tab bar lies inside that bar, or the bar cuts it
            const bar = el.closest(".topbar, .nav");
            let cut = false;
            if (bar && outline) {
              const grow = parseFloat(s.outlineOffset) + parseFloat(s.outlineWidth);
              const b = bar.getBoundingClientRect();
              cut = r.top - grow < b.top - 0.5 || r.bottom + grow > b.bottom + 0.5 || r.left - grow < b.left - 0.5 || r.right + grow > b.right + 0.5;
            }
            return { ok: outline || ring || stroke || own, cut, gone: r.width === 0 || r.height === 0, name: `${el.tagName.toLowerCase()}${(el as HTMLInputElement).type ? `[${(el as HTMLInputElement).type}]` : ""}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 25)}"` };
          });
          if (seen && !seen.ok && !seen.gone) out.push(`no focus mark on ${seen.name}`);
          if (seen?.cut) out.push(`focus ring cut by its bar on ${seen.name}`);
        }
        return [...new Set(out)];
      }),
    ).toEqual([]);
  });
}

// Screen reader pass (BA-68, Orca): the children of an image are presentational, so Chromium leaves a focusable
// element inside one out of the accessibility tree. The chart's keyboard stop then had no name, no role and no
// hint for the screen reader, only the live readout. The stop sits beside the image, never inside it.
test("every route: no control sits inside an image, and a chart's keyboard stop is in the accessibility tree", async ({ browser }) => {
  test.setTimeout(240_000);
  expect(
    await everyRoute(browser, 1280, (page) =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("[role=img] :is(a[href], button, input, select, textarea, [tabindex])")).map(
          (el) => `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}" is inside an image`,
        ),
      ),
    ),
  ).toEqual([]);
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 }, bypassCSP: true });
  const page = await visit(context, "/#/overview", ".home-answer-line");
  const stop = page.getByRole("group", { name: /^Menot päivittäin/ });
  await expect(stop).toHaveCount(1);
  await stop.focus();
  await expect(stop).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("[aria-live=polite]").filter({ hasText: /^\d+\.\d+\.: / }).first()).toBeVisible();
  await context.close();
});

// WCAG 2.5.8: a control is at least 24 px each way (a link in a line of text is exempt), and a tab of the phone's tab bar 44 px.
test("every route, 390 px: the controls are at least 24 px and the tabs 44 px", async ({ browser }) => {
  test.setTimeout(240_000);
  expect(
    await everyRoute(browser, 390, (page) =>
      page.evaluate(() => {
        const out: string[] = [];
        const name = (el: Element) => `${el.parentElement?.className && typeof el.parentElement.className === "string" ? el.parentElement.className.split(" ")[0] + " > " : ""}${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 25)}"`;
        const controls = document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem]");
        for (const el of Array.from(controls)) {
          if (!(el as HTMLElement).checkVisibility({ checkVisibilityCSS: true })) continue;
          // a checkbox or radio is touched through its label
          const type = (el as HTMLInputElement).type;
          const box = (type === "checkbox" || type === "radio") && el.closest("label") ? el.closest("label")! : el;
          const r = box.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || r.right <= 0 || r.bottom <= 0) continue;
          // a link in a line of text is exempt: it has words of the sentence beside it
          const inSentence = el.tagName === "A" && Array.from(el.parentElement?.childNodes ?? []).some((n) => n !== el && n.nodeType === Node.TEXT_NODE && /\S{2}/.test(n.textContent ?? ""));
          if (inSentence) continue;
          const min = el.closest(".nav") ? 44 : 24;
          if (r.width < min - 0.5 || r.height < min - 0.5) out.push(`${name(el)} is ${Math.round(r.width)}x${Math.round(r.height)}, needs ${min}`);
        }
        return [...new Set(out)];
      }),
    ),
  ).toEqual([]);
});

// a 40-character name keeps the top bar to one row
for (const width of [390, 1100, 1440]) {
  test(`a 40-character name stays on one line of the bar, ${width} px`, async ({ browser }) => {
    const dir = process.env.E2E_DIR ?? ".";
    const admin = await browser.newContext({ storageState: join(dir, "admin-state.json") });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const name = "Liisa Meikäläinen-Virtanen von Pitkänimi";
    const id = await createMember(admin, context, "pitkanimi", name);
    try {
      const page = await context.newPage();
      await page.goto("/#/overview");
      const small = page.locator(".user-menu summary .small");
      await small.waitFor({ state: width < 1100 ? "attached" : "visible" });
      const bar = await page.locator(".topbar").boundingBox();
      expect(bar!.height).toBeLessThanOrEqual(49);
      // the bar of a build with more pages leaves less room: the name must give way by itself, not wrap
      expect(await small.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("nowrap");
      if (width >= 1100) {
        const lines = await small.evaluate((el) => el.getClientRects()[0]!.height / parseFloat(getComputedStyle(el).lineHeight));
        expect(lines).toBeLessThan(1.5);
      }
    } finally {
      await context.close();
      await admin.close();
      await removeMember(browser, id);
    }
  });
}
