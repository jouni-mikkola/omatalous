import { expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { overflow } from "./helpers.ts";

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

/** Opens content, not header menus: closing a menu on an outside click would consume a chart's click. */
export async function openAll(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  const targets = page.locator("main details:not([open]) > summary");
  for (let step = 0; step < 128; step++) {
    if (await targets.count() === 0) return;
    // The locator changes after each click, so choose afresh rather than indexing a shrinking list.
    await targets.first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main .loading, main .skel")).toHaveCount(0, { timeout: 15_000 });
  }
  throw new Error("Content details did not finish opening");
}

/** Opens the first row's drill of each table that has them, so the buttons of an opened row (a menu, a statement link) are measured too. */
async function openDrills(page: Page): Promise<void> {
  const tables = page.locator("main table:has(button.rt-drill)");
  for (let i = 0; i < (await tables.count()); i++) {
    const button = tables.nth(i).locator('button.rt-drill[aria-expanded="false"]:visible').first();
    if ((await button.count()) === 0) continue;
    await button.click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main .loading, main .skel")).toHaveCount(0, { timeout: 15_000 });
  }
}

interface Found {
  id: string;
  help: string;
  nodes: { target: unknown[] }[];
}

/**
 * What a thumb must hit where the pointer is a finger: every link, button, sort head and summary reaches 44 px (its own
 * box or the reach of its ::after) and is 24 px wide, a mark drawn in a chart's svg is 24 px each way, and a checkbox or
 * radio the user can see is 24 px wide and high. The targets also keep apart: no two boxes overlap, and the point at the
 * middle of a target hits that target and not its neighbour. A link inside a sentence is exempt, as WCAG 2.5.8 has it: its
 * parent flows text around it (a flex or grid parent makes the link a box of its own, whatever words stand beside it).
 */
async function touchTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // one line for each kind of target, with how many there are: a table has a link on every row
    const found = new Map<string, { name: string; where: string; n: number }>();
    const note = (line: string, name: string, where = "") => found.set(line, { name, where: found.get(line)?.where ?? where, n: 1 + (found.get(line)?.n ?? 0) });
    // pinned: fixed, or stuck to an edge of the window (not a table's head, which is part of the table)
    const boxes: { el: Element; kind: string; name: string; left: number; right: number; top: number; bottom: number; pinned: boolean; parent: string }[] = [];
    const describe = (el: Element | null) => (el ? `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : ""}` : "");
    // closed details keep their boxes but show nothing, and a clipped box (the head of a table that is a list of blocks) has no size to hit
    const unseen = (el: Element) => {
      for (let up: Element | null = el; up; up = up.parentElement) {
        const parent = up.parentElement;
        if (parent instanceof HTMLDetailsElement && !parent.open && up.tagName !== "SUMMARY") return true;
        if (up !== el) {
          const b = up.getBoundingClientRect();
          if ((b.width <= 2 || b.height <= 2) && getComputedStyle(up).overflow !== "visible") return true;
        }
      }
      return false;
    };
    window.scrollTo(0, 0);
    const sentence = (el: Element) => {
      const parent = el.parentElement;
      if (!parent || /flex|grid/.test(getComputedStyle(parent).display)) return false;
      return Array.from(parent.childNodes).reduce((n, node) => n + (node.nodeType === 3 ? (node.textContent ?? "").trim().length : 0), 0) >= 8;
    };
    for (const el of Array.from(document.querySelectorAll<HTMLElement | SVGElement>("a[href], button, summary, [role=button], input[type=checkbox], input[type=radio]"))) {
      const r = el.getBoundingClientRect();
      // a control that is not on the page (closed details, a hidden input, the skip link's 1 px) has no box
      if (r.width < 4 || r.height < 4 || getComputedStyle(el).visibility === "hidden" || el.closest("[hidden], [inert]") || unseen(el)) continue;
      const name = (el.textContent || el.closest("label")?.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40);
      const kind = describe(el);
      let problem = "";
      if (el instanceof HTMLInputElement) {
        if (r.width < 23.5 || r.height < 23.5) problem = `is ${Math.round(r.width)} x ${Math.round(r.height)} px, under 24`;
      } else if (el instanceof SVGElement) {
        if (r.width < 23.5 || r.height < 23.5) problem = `is ${Math.round(r.width)} x ${Math.round(r.height)} px, under 24 in a chart`;
      } else if (!(el instanceof HTMLAnchorElement && sentence(el))) {
        const after = getComputedStyle(el, "::after");
        const reach = Math.max(r.height, after.position === "absolute" && after.content !== "none" ? parseFloat(after.height) || 0 : 0);
        if (reach < 43.5) problem = `reaches ${Math.round(reach)} px, under 44`;
        else if (r.width < 23.5) problem = `is ${Math.round(r.width)} px wide, under 24`;
      }
      if (problem) note(`${kind} ${problem}`, name);
      // the skip link waits off the screen and a link in a sentence has no box of its own
      if (r.right <= 0 || r.left >= document.documentElement.scrollWidth || (el instanceof HTMLAnchorElement && sentence(el))) continue;
      let pinned = false;
      for (let up: Element | null = el; up && !pinned; up = up.parentElement) {
        const position = getComputedStyle(up).position;
        pinned = position === "fixed" || (position === "sticky" && !up.closest("table"));
      }
      boxes.push({ el, kind, name, left: r.left + scrollX, right: r.right + scrollX, top: r.top + scrollY, bottom: r.bottom + scrollY, pinned, parent: describe(el.parentElement) });
    }
    // no two targets overlap: what is drawn over a neighbour takes its taps
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        if (a.pinned !== b.pinned || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (across > 1 && down > 1) {
          const at = (x: typeof a) => `${Math.round(x.left)},${Math.round(x.top)} ${Math.round(x.right - x.left)}x${Math.round(x.bottom - x.top)} in ${x.parent}`;
          note(`${a.kind} overlaps ${b.kind} by ${Math.round(down)} px`, `${a.name}" and "${b.name}`, `${at(a)} and ${at(b)}`);
        }
      }
    }
    // the middle of a target is its own: the nearest thing on top of it is the target or what it holds
    for (const { el, kind, name, pinned } of boxes) {
      // a pinned bar stays where it is: it is judged at the top of the page, the rest in the middle of the window
      if (pinned) window.scrollTo(0, 0);
      else el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      const label = el instanceof HTMLInputElement ? el.closest("label") : null;
      if (hit && !el.contains(hit) && !(label && label.contains(hit))) {
        const over = `${hit.tagName.toLowerCase()}${typeof hit.className === "string" && hit.className ? `.${hit.className.trim().split(/\s+/).join(".")}` : ""}`;
        note(`${kind} has ${over} over its middle`, name);
      }
    }
    window.scrollTo(0, 0);
    return Array.from(found, ([line, { name, where, n }]) => `${line}, as "${name}"${where ? ` (${where})` : ""}${n > 1 ? ` and ${n - 1} more` : ""}`);
  });
}

/** The same visibility, overflow and accessibility checks for every table view. */
export async function auditTables(page: Page, width: number, touch = width < 600): Promise<string[]> {
  // A shell can appear before a lazy view mounts its loading state and chart controls.
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main .loading, main .skel")).toHaveCount(0, { timeout: 15_000 });
  const problems = await page.evaluate(() => Array.from(document.querySelectorAll("table"))
    .filter((t) => !(t.offsetWidth || t.offsetHeight) && !t.closest("details.card:not([open])"))
    .map((t) => `${t.querySelector("caption")?.textContent?.trim() || "(no name)"}: hidden until something is opened`));
  await openAll(page);
  if (touch) await openDrills(page);
  const wide = await overflow(page);
  if (wide > 0) {
    const past = await page.evaluate(() =>
      Array.from(document.querySelectorAll("body *"))
        .filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.25 && getComputedStyle(e).position !== "fixed" && !e.closest("thead, svg"))
        .slice(0, 6)
        .map((e) => `${e.tagName.toLowerCase()}${typeof e.className === "string" && e.className ? `.${e.className.trim().split(/\s+/).join(".")}` : ""} "${(e.textContent ?? "").trim().slice(0, 24)}" in ${e.parentElement?.tagName.toLowerCase()}.${typeof e.parentElement?.className === "string" ? e.parentElement.className.trim().split(/\s+/).join(".") : ""} to ${e.getBoundingClientRect().right.toFixed(1)}`),
    );
    problems.push(`the page is ${wide} px wider than the window${past.length ? `, reached by ${past.join("; ")}` : ""}`);
  }
  const tables = await page.evaluate((w) => {
    const out: string[] = [];
    for (const t of Array.from(document.querySelectorAll("table"))) {
      const name = t.querySelector("caption")?.textContent?.trim() || t.getAttribute("aria-label") || "(no name)";
      if (!(t.offsetWidth || t.offsetHeight)) out.push(`${name}: not shown`);
      if (t.getBoundingClientRect().right > w + 0.5) out.push(`${name}: reaches past the window`);
      for (let e: HTMLElement | null = t.parentElement; e && e !== document.body; e = e.parentElement) {
        const x = getComputedStyle(e).overflowX;
        if ((x === "auto" || x === "scroll") && e.scrollWidth > e.clientWidth + 1) out.push(`${name}: scrolls sideways inside ${e.className || e.tagName}`);
      }
      if (t.closest(".table-wrap, .rt-wrap-scroll")) out.push(`${name}: sits in a scroll frame`);
      // the bars of one column are one scale: each starts on the same line, whatever the width of the figure beside it
      const starts = new Map<number, number[]>();
      for (const track of Array.from(t.querySelectorAll<HTMLElement>(".rt-bar-track")).filter((b) => !b.closest("tr.rt-detail"))) {
        const cell = track.closest("td, th") as HTMLTableCellElement | null;
        if (!cell || !track.offsetWidth) continue;
        starts.set(cell.cellIndex, [...(starts.get(cell.cellIndex) ?? []), track.getBoundingClientRect().left]);
      }
      for (const [col, xs] of starts) if (Math.max(...xs) - Math.min(...xs) > 0.5) out.push(`${name}: the bars of column ${col + 1} start ${Math.round(Math.max(...xs) - Math.min(...xs))} px apart`);
    }
    return out;
  }, width);
  problems.push(...tables);
  if (touch) problems.push(...(await touchTargets(page)));
  if (!(await page.locator("table").count())) return problems;
  await page.addScriptTag({ path: AXE });
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* one that never ends */ } }));
  const found = await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (c: object, o: object) => Promise<{ violations: Found[] }> } }).axe.run;
    return (await run({ include: [["table"]] }, { resultTypes: ["violations"] })).violations;
  });
  for (const v of found) problems.push(`axe ${v.id}: ${v.help}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  await expect(page.locator('main button:text-is("Taulukko")'), `no chart has a table switch at ${page.url()}`).toHaveCount(0);
  return problems;
}
