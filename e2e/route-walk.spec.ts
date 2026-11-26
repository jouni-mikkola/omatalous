import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serious } from "./axe.ts";
import { auditTables, openAll, openDrills } from "./table-audit.ts";
import { A11Y_ROUTES, type Check, ONE_LINK_ROUTES, TABLE_ROUTES, walk } from "./walk.ts";

// Decision: whether every page of the app, at the width of a phone and of a desktop, can be used by anyone: the Version 1.0
// check (S14). Each route is opened once per walk, and every check of a walk reads that one load, so a red walk lists all of its
// problems, `check: route: problem`, rather than the first. The order is the order of the checks below: those that read the
// page as it loads come first, those that open details and drills last.
//
// - axe finds nothing serious or critical, and the page's console is clean
// - the headings are in order
// - no control sits inside an image (Screen reader pass, BA-68: the children of an image are presentational, so Chromium leaves
//   a focusable element inside one out of the accessibility tree)
// - a control is at least 24 px each way and a tab of the phone's tab bar 44 px (WCAG 2.5.8; a link in a line of text is exempt)
// - the focus can be seen
// - every table (see `auditTables`): the page does not scroll sideways, no table scrolls inside its frame, every table is shown
//   and axe finds nothing in any table. Where the pointer is a finger (390 px, and 1024 px with touch) every link, button, sort
//   head and summary also reaches 44 px, no two targets overlap, the middle of each hits it and every checkbox is 24 px
// - what the toolbar and the CSV link of a table read is what the table shows
// - no page has two links to the same address

const axe: Check = { name: "axe", routes: A11Y_ROUTES, run: (page) => serious(page) };

const headings: Check = {
  name: "headings",
  routes: A11Y_ROUTES,
  run: (page) =>
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
};

// the chart's keyboard stop sits beside the image, never inside it
const noControlInImage: Check = {
  name: "no control in an image",
  routes: A11Y_ROUTES,
  run: (page) =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("[role=img] :is(a[href], button, input, select, textarea, [tabindex])")).map(
        (el) => `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}" is inside an image`,
      ),
    ),
};

const touchSizes: Check = {
  name: "24 px controls",
  routes: A11Y_ROUTES,
  run: (page) =>
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
};

// Tab through the page up to 60 stops; the walk ends where the focus is back on the first stop or leaves the page.
const focusSeen: Check = {
  name: "focus",
  routes: A11Y_ROUTES,
  run: async (page) => {
    const out: string[] = [];
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const seen = await page.evaluate((first) => {
        const w = window as unknown as { __firstStop?: Element };
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return { end: true } as const;
        if (first) w.__firstStop = el;
        else if (el === w.__firstStop) return { end: true } as const;
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
        return { end: false, ok: outline || ring || stroke || own, cut, gone: r.width === 0 || r.height === 0, name: `${el.tagName.toLowerCase()}${(el as HTMLInputElement).type ? `[${(el as HTMLInputElement).type}]` : ""}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 25)}"` } as const;
      }, i === 0);
      if (seen.end) break;
      if (!seen.ok && !seen.gone) out.push(`no focus mark on ${seen.name}`);
      if (seen.cut) out.push(`focus ring cut by its bar on ${seen.name}`);
    }
    return [...new Set(out)];
  },
};

const tables = (width: number, touch: boolean): Check => ({
  name: "tables",
  routes: TABLE_ROUTES,
  run: async (page, route) => {
    const found = await auditTables(page, width, touch);
    if (process.env.E2E_SHOTS) {
      const name = route.replace(/^\/#\//, "").replace(/[^a-z0-9]+/g, "-");
      await page.screenshot({ path: join(process.env.E2E_SHOTS, `${name}-${width}.png`), fullPage: true });
    }
    return found;
  },
});

// What the toolbar and the CSV link of a table read is what the table shows: the search finds a row by the first word the row
// says, and the CSV has a word or a figure in each of its lines. A cell made of components (a payee with its tags, an amount) is
// read too. Both exist only for a long list (LONG_LIST_ROWS in table/view.ts): a table of ten rows or fewer has no search box and
// no CSV link, and the link is one for every table, under it, never a button in the bar above.
const LONG_LIST = 10;
const DATA_ROWS = "tbody tr:not(.rt-group):not(.rt-detail):not(.rt-subrow):not(.rt-spacer)";

function toolbars(): Check {
  let searched = 0;
  let saved = 0;
  return {
    name: "toolbar and CSV",
    routes: TABLE_ROUTES,
    run: async (page) => {
      const problems: string[] = [];
      await openAll(page);
      const frames = page.locator("main .rt-wrap");
      for (let i = 0; i < (await frames.count()); i++) {
        const frame = frames.nth(i);
        if (!(await frame.isVisible())) continue;
        const name = ((await frame.locator("caption").first().textContent()) ?? "").trim();
        const rows = frame.locator(DATA_ROWS);
        const count = await rows.count();
        const bar = frame.locator("xpath=preceding-sibling::*[1][contains(@class,'rtb')]");
        const link = frame.locator("xpath=following-sibling::*[1][contains(@class,'rt-csv')]");
        const box = bar.getByRole("searchbox");
        // a table the page reads whole (`search={false} csv={false}`) has neither, however long
        if ((await frame.getAttribute("data-plain")) !== null) {
          if ((await box.count()) > 0 || (await link.count()) > 0) problems.push(`${name}: a plain table has a search box or a CSV link`);
          continue;
        }
        if (count <= LONG_LIST) {
          if ((await box.count()) > 0) problems.push(`${name}: ${count} rows have a search box`);
          if ((await link.count()) > 0) problems.push(`${name}: ${count} rows have a CSV link`);
          continue;
        }
        if ((await bar.getByRole("button", { name: "Lataa CSV" }).count()) > 0) problems.push(`${name}: the CSV is a button in the bar`);
        const first = ((await rows.first().locator("th, td").first().innerText()) ?? "").split(/\s+/).find((w) => /^\p{L}{3,}$/u.test(w));
        if (first && (await box.count()) > 0) {
          searched++;
          await box.fill(first);
          if ((await rows.count()) === 0) problems.push(`${name}: searching "${first}" finds no row`);
          await box.fill("");
        }
        // a sheet (Verot) saves its tables in one file of its own, with its own button
        if ((await link.count()) === 0 && (await frame.locator("xpath=ancestor::*[@id][1]").getByRole("button", { name: "Lataa CSV" }).count()) > 0) continue;
        if ((await link.count()) === 0) {
          problems.push(`${name}: ${count} rows have no CSV link`);
          continue;
        }
        saved++;
        const [download] = await Promise.all([page.waitForEvent("download"), link.getByRole("button", { name: "Lataa CSV" }).click()]);
        const lines = (await readFile((await download.path())!, "utf8")).replace(String.fromCharCode(0xfeff), "").trim().split("\r\n").slice(1);
        const empty = lines.filter((l) => /^[;"\s]*$/.test(l.replace(/;/g, ""))).length;
        if (empty > 0) problems.push(`${name}: ${empty} of ${lines.length} CSV lines have no content`);
      }
      return problems;
    },
    end: () => [...(searched > 0 ? [] : ["no long table was searched"]), ...(saved > 0 ? [] : ["no long table was saved"])],
  };
}

// With every details open and the first row of each table opened, no page has two links that go to the same address: a second
// link to a place is a second thing to read, find and tap for no new answer. The check reads the links a reader can see in
// the page's main part.
const oneLink: Check = {
  name: "one link",
  routes: ONE_LINK_ROUTES,
  run: async (page) => {
    await openAll(page);
    await openDrills(page);
    return page.evaluate(() => {
      const seen = new Map<string, string[]>();
      for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("main a[href]"))) {
        let hidden = !a.checkVisibility({ checkVisibilityCSS: true }) || a.getClientRects().length === 0 || !!a.closest("[hidden], [inert]");
        for (let up: Element | null = a; up && !hidden; up = up.parentElement) {
          const parent = up.parentElement;
          if (parent instanceof HTMLDetailsElement && !parent.open && up.tagName !== "SUMMARY") hidden = true;
        }
        if (hidden) continue;
        const name = (a.textContent || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
        const box = a.closest("section, table, details, li, [id]");
        const where = box ? `${box.tagName.toLowerCase()}${box.id ? `#${box.id}` : ""}${typeof box.className === "string" && box.className ? `.${box.className.trim().split(/\s+/).join(".")}` : ""}` : "main";
        seen.set(a.href, [...(seen.get(a.href) ?? []), `"${name}" in ${where}`]);
      }
      return Array.from(seen).filter(([, links]) => links.length > 1).map(([href, links]) => `${href.replace(location.origin, "")} is linked ${links.length} times: ${links.join("; ")}`);
    });
  },
};

// Each walk is its own test and the file runs in parallel mode, so that the workers take the walks one by one instead of the
// file whole (CI runs this file as the project `walks`, apart from the shards of the app project). The checks of a width are split over two walks; each walk opens its routes anew, and every
// check still reads every route it names. The first walk of a width reads the console, as the first look at the page.
test.describe.configure({ mode: "parallel" });

test("every route, 390 px: the page as it loads", async ({ browser }) => {
  test.setTimeout(600_000);
  expect(await walk(browser, { width: 390, console: true, checks: [axe, headings, touchSizes, focusSeen] })).toEqual([]);
});

test("every route, 390 px: tables and links", async ({ browser }) => {
  test.setTimeout(600_000);
  expect(await walk(browser, { width: 390, checks: [tables(390, true), oneLink] })).toEqual([]);
});

// 1280 px is no longer a width of its own: the image check reads the desktop width of the walk
test("every route, 1440 px: the page as it loads", async ({ browser }) => {
  test.setTimeout(600_000);
  expect(await walk(browser, { width: 1440, console: true, checks: [axe, headings, noControlInImage, focusSeen] })).toEqual([]);
});

test("every route, 1440 px: tables and links", async ({ browser }) => {
  test.setTimeout(600_000);
  expect(await walk(browser, { width: 1440, downloads: true, checks: [tables(1440, false), toolbars(), oneLink] })).toEqual([]);
});

// a finger on a tablet's wide screen
test("every table: 1024 px with a finger", async ({ browser }) => {
  test.setTimeout(600_000);
  expect(await walk(browser, { width: 1024, touch: true, checks: [tables(1024, true)] })).toEqual([]);
});
