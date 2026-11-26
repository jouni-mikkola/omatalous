// @ts-check
/**
 * The `--steps` module of `tools/shots.mjs` that records the README film: a pointer that moves and clicks in the real app,
 * which `shots` started on an empty data folder, and a screenshot after each move. The computer's screen (1000 px) loads the
 * example data with the empty first page's own button, then goes through Tapahtumat, Yhteenveto, Laskut and Raportit; the
 * phone's screen (390 px) shows Yhteenveto and Laskut. Each caption is written from the figures on the page, and the
 * steps stop with an error when the figures a caption adds up do not add up on the page.
 * Writes the screenshots, the caption bars and part-<width>.json to $FILM_DIR; tools/readme-film/film.mjs makes the film.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PHONE, SIZE } from "./compose.mjs";

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("@playwright/test").Locator} Locator */
/** @typedef {import("./compose.mjs").Record} Record */
/** @typedef {import("./compose.mjs").Box} Box */

/** One frame while the pointer moves; about 25 frames a second. */
const STEP_MS = 40;
/** The pointer's glide to a target, and the three frames of its press. */
const GLIDE_MS = 480;
const CLICK_MS = GLIDE_MS + 160 + 80 + 80;

/**
 * How long a caption stays on the screen in all: 17 characters a second, the pace of subtitles for adults, and at least
 * 2.6 s. The pointer's moves under it count, so the film holds a page only for the rest.
 */
export function readMs(/** @type {string} */ caption) {
  return Math.max(2600, Math.round((caption.length / 17) * 1000));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The cents of a sum as the app writes it: "−4 905,68 €", "78 €". */
export function cents(/** @type {string} */ text) {
  const m = /([−-]?)\s*(\d{1,3}(?:[\s  ]\d{3})*|\d+)(?:,(\d{2}))?\s*€/.exec(text);
  if (!m) throw new Error(`no sum in "${text}"`);
  const whole = Number((m[2] ?? "").replace(/\D/g, ""));
  return (m[1] ? -1 : 1) * (whole * 100 + Number(m[3] ?? 0));
}

/** A sum as the app writes it, with a plain space: 482742 is "4 827,42 €". */
export function euros(/** @type {number} */ c) {
  const abs = Math.abs(c);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${c < 0 ? "−" : ""}${whole},${String(abs % 100).padStart(2, "0")} €`;
}

/** A Finnish date "1.10.2025" in English, "1 Oct 2025"; "25.11." is "25 Nov". */
export function englishDate(/** @type {string} */ text) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(text.trim());
  if (!m) throw new Error(`no date in "${text}"`);
  return [m[1], MONTHS[Number(m[2]) - 1]?.slice(0, 3), m[3]].filter(Boolean).join(" ");
}

/** The days of a Finnish span "1.–12.11." in English, "1–12 Nov"; one day "1.11." is "1 Nov". */
export function englishDays(/** @type {string} */ text) {
  const m = /^(\d{1,2})\.(?:–(\d{1,2})\.)?(\d{1,2})\.$/.exec(text.trim());
  const month = MONTHS[Number(m?.[3]) - 1]?.slice(0, 3);
  if (!m || !month) throw new Error(`no days in "${text}"`);
  return { text: `${m[1]}${m[2] ? `–${m[2]}` : ""} ${month}`, days: m[2] ? Number(m[2]) - Number(m[1]) + 1 : 1 };
}

/** A sum as the page shows it: whole euros stay whole ("4 893 €"), cents stay cents. */
const shown = (/** @type {string} */ text) => (/,\d{2}/.test(text) ? euros(cents(text)) : euros(cents(text)).replace(/,00 €$/, " €"));

/** Text with the page's spaces made plain. */
const plain = (/** @type {string | null} */ t) => (t ?? "").replace(/[\s  ]+/g, " ").trim();

class Film {
  /** @param {Page} page @param {string} dir @param {boolean} phone */
  constructor(page, dir, phone) {
    this.page = page;
    this.dir = dir;
    this.phone = phone;
    this.origin = new URL(page.url()).origin;
    this.part = phone ? "phone" : "desk";
    /** @type {Record[]} */
    this.records = [];
    this.caption = "";
    /** how long the caption has been on the screen so far */
    this.shown = 0;
    this.bar = "";
    /** @type {{ x: number, y: number } | null} */
    this.pointer = null;
    /** @type {Box[]} */
    this.marks = [];
    /** @type {Page | null} */
    this.captionPage = null;
    mkdirSync(join(dir, "shots"), { recursive: true });
    mkdirSync(join(dir, "bars"), { recursive: true });
  }

  /** The caption from now on, its bar drawn by the app's own font in a page of its own. */
  async say(/** @type {string} */ text) {
    this.caption = text;
    this.shown = 0;
    this.bar = join(this.dir, "bars", `${createHash("sha256").update(text).digest("hex").slice(0, 16)}.png`);
    if (existsSync(this.bar)) return;
    if (!this.captionPage) {
      this.captionPage = await this.page.context().newPage();
      await this.captionPage.setViewportSize({ width: SIZE.width, height: SIZE.bar });
      // the app's page for its stylesheet and font: the bar takes the place of the app in it
      await this.captionPage.goto("/#/overview");
      await this.captionPage.waitForLoadState("networkidle");
    }
    await this.captionPage.evaluate(
      async ({ text, height }) => {
        const bar = document.createElement("div");
        const words = document.createElement("span");
        words.textContent = text;
        bar.append(words);
        // the CSS object model: the page's policy allows no style attribute in the markup
        Object.assign(bar.style, {
          boxSizing: "border-box",
          height: `${height}px`,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          background: "var(--ink)",
          color: "var(--on-ink)",
          font: "600 18px/1.35 var(--font-body)",
        });
        document.body.replaceChildren(bar);
        Object.assign(document.body.style, { margin: "0", padding: "0", overflow: "hidden" });
        await document.fonts.ready;
      },
      { text, height: SIZE.bar },
    );
    const lines = await this.captionPage.evaluate(() => {
      const words = /** @type {HTMLElement} */ (document.body.firstElementChild?.firstElementChild);
      return Math.round(words.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(words).lineHeight));
    });
    if (lines > 2) throw new Error(`the caption takes ${lines} lines, two fit: ${text}`);
    await this.captionPage.screenshot({ path: this.bar, animations: "disabled" });
  }

  /** One screenshot of the page, shown for `ms`. */
  async shoot(/** @type {number} */ ms, /** @type {Partial<Record>} */ extra = {}) {
    // a picture shows only the app this run started on an empty data folder
    if (new URL(this.page.url()).origin !== this.origin) throw new Error(`the page left the app (${this.page.url()}): no frame is taken`);
    const shot = join(this.dir, "shots", `${this.part}-${String(this.records.length).padStart(4, "0")}.png`);
    await this.page.screenshot({ path: shot, animations: "disabled", caret: "hide" });
    this.records.push({ shot, ms, caption: this.caption, bar: this.bar, phone: this.phone, pointer: this.pointer && { ...this.pointer }, press: null, marks: [...this.marks], ...extra });
    this.shown += ms;
  }

  /**
   * Holds the page until its caption has been on the screen as long as it takes to read (`readMs`), counting the
   * frames already shown under it and the `then` milliseconds of the click that follows under it; at least a second.
   */
  async read(/** @type {Partial<Record>} */ extra = {}, then = CLICK_MS) {
    await this.shoot(Math.max(1000, readMs(this.caption) - this.shown - then), extra);
  }

  /**
   * The pointer glides to a point, a frame at each step. With `hover` false only the drawn pointer moves and the
   * browser's mouse goes to the end in one move: a chart under the path would open its readout on the way.
   */
  async glide(/** @type {{ x: number, y: number }} */ to, ms = GLIDE_MS, hover = true) {
    const from = this.pointer ?? to;
    const n = Math.max(1, Math.round(ms / STEP_MS));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.pointer = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      if (hover || i === n) await this.page.mouse.move(this.pointer.x, this.pointer.y);
      await this.shoot(STEP_MS);
    }
  }

  /**
   * Where the pointer rests while a box is read, off the text: right of the box's lower corner, or in the middle of its
   * lower edge when the box reaches the side of the screen (a row of a list has its sum there).
   */
  beside(/** @type {Box} */ box) {
    const limit = this.phone ? PHONE : { width: SIZE.width, height: SIZE.page };
    const y = Math.min(limit.height - 24, Math.round(box.y + box.height - 4));
    // 20 px clears the outline drawn round the box, so the pointer covers none of its text
    if (box.x + box.width + 20 > limit.width - 40) return { x: Math.round(box.x + box.width / 2), y };
    return { x: Math.round(box.x + box.width + 20), y };
  }

  /** The middle of what a locator finds, in the page's pixels, once it is on the screen. */
  async centre(/** @type {Locator} */ target) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error(`${target} has no box on the page`);
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  }

  /**
   * The pointer goes to the target and clicks it (a finger taps it on the phone). The press is drawn on the page it is
   * made on, and the next frame is the page the click opened, once it has loaded: a frame half way would show the
   * caption of one page over another. `hover` as for `glide`.
   */
  async click(/** @type {Locator} */ target, hover = true) {
    const at = await this.centre(target);
    if (this.phone) this.pointer = null;
    else await this.glide(at, GLIDE_MS, hover);
    for (let age = 0; age < 3; age++) await this.shoot(age ? 80 : 160, { press: { ...at, age } });
    await this.page.mouse.click(at.x, at.y);
    await this.settle();
  }

  /**
   * Waits until the page has its answers and draws no "Ladataan…". The footer is left out, as `pnpm docs:shots` leaves it
   * out: a short page would show it and a long one not, and it says nothing about the household.
   */
  async settle() {
    await this.page.waitForLoadState("networkidle");
    await this.page.getByText("Ladataan…").first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    await this.page.evaluate(async () => {
      for (const footer of document.querySelectorAll("footer")) /** @type {HTMLElement} */ (footer).style.display = "none";
      await document.fonts.ready;
    });
  }

  /** The page scrolls by `dy` pixels, a frame at each step, as a finger or a wheel would move it. */
  async scroll(/** @type {number} */ dy, ms = 480) {
    const n = Math.max(1, Math.round(ms / STEP_MS));
    let done = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const to = Math.round(dy * (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2));
      await this.page.mouse.wheel(0, to - done);
      done = to;
      await this.page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => r(true))));
      await this.shoot(STEP_MS);
    }
  }

  /** The box of what a locator finds, in the page's pixels; several are joined into one. */
  async box(/** @type {Locator[]} */ ...targets) {
    const boxes = [];
    for (const t of targets) {
      const b = await t.boundingBox();
      if (!b) throw new Error(`${t} has no box on the page`);
      boxes.push(b);
    }
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const box = { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
    const limit = this.phone ? PHONE : { width: SIZE.width, height: SIZE.page };
    if (box.y < 0 || box.y + box.height > limit.height) throw new Error(`a box the caption speaks of is not on the screen: ${JSON.stringify(box)}`);
    return box;
  }

  async save() {
    await this.captionPage?.close();
    writeFileSync(join(this.dir, `part-${this.part}.json`), JSON.stringify(this.records, null, 1));
  }
}

/** A tab of the main navigation. */
const tab = (/** @type {Page} */ page, /** @type {string} */ name) => page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link", { name, exact: true });

/**
 * The first month of the Laskut table with bills in it: a group head carries core's sum of the month's bills, and once a
 * bill of a month is still to pay, "Tulossa": a closed month says it in its head, an open one in the total that ends its rows.
 * A month with nothing to pay is passed.
 */
async function billsMonth(/** @type {Locator} */ list) {
  for (const group of await list.locator("tr.rt-group").all()) {
    const open = (await group.locator("button[aria-expanded=true]").count()) > 0;
    const text = open ? await group.locator("xpath=following-sibling::tr[contains(@class,'bill-total')][1]").textContent() : await group.textContent();
    const head = /Tulossa ([\d ,]+ €)/.exec(plain(text ?? ""));
    if (head && cents(/** @type {string} */ (head[1])) > 0) return { month: group, head };
  }
  throw new Error("Laskut: no month has a sum of bills still to pay");
}

/** The computer's screen: from the empty first page to Raportit. */
async function desk(/** @type {Film} */ film) {
  const { page } = film;
  await page.setViewportSize({ width: SIZE.width, height: SIZE.page });
  film.pointer = { x: 760, y: 560 };
  await page.mouse.move(film.pointer.x, film.pointer.y);

  // 1. the empty first page; the example data stands in for a bank
  const load = page.getByRole("button", { name: "Lataa esimerkkitiedot" });
  await load.waitFor({ state: "visible", timeout: 30_000 });
  await film.settle();
  await film.say("A new install is empty. The example data stands in for a bank.");
  await film.read();
  await film.click(load);
  await page.locator(".home-summary").waitFor({ state: "visible", timeout: 30_000 });
  await film.settle();
  // the first page has its figures now; the pointer leaves it for Tapahtumat without opening the chart's readout
  await film.say("The example data is loaded.");
  await film.read();
  await film.click(tab(page, "Tapahtumat"), false);

  // 2. the rows that came in, each with a payee and a category; one row whose payee the app read from the bank's text
  const count = plain(await page.locator(".tx-totals-count").textContent());
  const span = plain(await page.locator(".tx-totals-span").textContent());
  const rows = Number(/^(\d[\d ]*) tapahtumaa$/.exec(count)?.[1]?.replace(/ /g, ""));
  // the span within the year of today has no year: "1.–26.11."
  const dates = /^\d{1,2}\.(?:–\d{1,2}\.)?\d{1,2}\.$/.test(span);
  if (!rows || !dates) throw new Error(`Tapahtumat shows "${count}" and "${span}"`);
  // the list opens on the month so far, which is what the span names
  const [, first, last, spanMonth] = /** @type {RegExpExecArray} */ (/^(\d{1,2})\.(?:–(\d{1,2})\.)?(\d{1,2})\.$/.exec(span));
  const year = new Date().getFullYear();
  const iso = (/** @type {string} */ d) => `${year}-${String(spanMonth).padStart(2, "0")}-${d.padStart(2, "0")}`;
  const period = { from: iso(/** @type {string} */ (first)), to: iso(last ?? /** @type {string} */ (first)) };
  const unsorted = await page.evaluate(async ([total, period]) => {
    /** @type {{ merchant?: string | null, category?: string | null }[]} */
    const all = [];
    while (all.length < total) {
      const res = await fetch(`/api/transactions?from=${period.from}&to=${period.to}&limit=500&offset=${all.length}`);
      const page = /** @type {{ items: { merchant?: string | null, category?: string | null }[] }} */ (await res.json());
      if (!page.items.length) break;
      all.push(...page.items);
    }
    return { read: all.length, without: all.filter((t) => !t.merchant || !t.category).length };
  }, /** @type {[number, { from: string, to: string }]} */ ([rows, period]));
  if (unsorted.read !== rows || unsorted.without) throw new Error(`Tapahtumat: ${unsorted.without} of ${unsorted.read} rows lack a payee or a category`);
  await film.say(`Tapahtumat: ${rows} transactions, ${englishDays(span).text}, each with a payee and a category.`);
  await film.shoot(1200);
  // a closed row holds the payee, the category and the amount; the bank's text is in the API's rows and in the opened row
  const bankText = await page.evaluate(async () => {
    const res = await fetch("/api/transactions?limit=100");
    const body = /** @type {{ items: { merchant?: string | null, description?: string | null, counterparty?: string | null }[] }} */ (await res.json());
    return Object.fromEntries(body.items.map((t) => [t.merchant ?? "", t.description || t.counterparty || ""]));
  });
  const visible = page.locator("tbody tr").filter({ has: page.locator(".tx-name") });
  // the totals above the table take most of the screen: the page scrolls to the rows, and back after them
  const firstTop = await visible.first().boundingBox();
  const toRows = firstTop ? Math.max(0, Math.round(firstTop.y - 240)) : 0;
  if (toRows) await film.scroll(toRows);
  let picked = null;
  for (const row of await visible.all()) {
    const name = plain(await row.locator(".tx-name").textContent());
    const text = plain(bankText[name] ?? "");
    const category = plain(await row.locator(".tx-chip-label").textContent().catch(() => ""));
    const box = await row.boundingBox();
    if (!box || box.y + box.height > SIZE.page) break;
    // the payee is a word of the bank's text, which says more: not a payee the bank sent in a field of its own
    const words = name.toUpperCase().split(/[^\p{L}\d]+/u).filter((w) => w.length > 2);
    const upper = text.toUpperCase();
    if (category && category !== "Omat siirrot" && text.length > name.length + 4 && words.some((w) => upper.includes(w))) {
      picked = row;
      break;
    }
  }
  if (!picked) throw new Error("no row on the first screen of Tapahtumat whose payee the app read from a longer bank text");
  // the outlines are what the caption names: the payee and the category
  film.marks = [await film.box(picked.locator(".tx-name")), await film.box(picked.locator(".tx-chip-label"))];
  await film.glide(film.beside(/** @type {Box} */ (film.marks[1])));
  await film.read();
  film.marks = [];
  if (toRows) await film.scroll(-toRows);

  // 4. Yhteenveto: what is left on payday after the bills and the everyday spending before it
  await film.click(tab(page, "Yhteenveto"));
  const answer = page.locator('[data-tile="left"]');
  await answer.waitFor({ state: "visible" });
  const left = plain(await answer.locator(".fig").textContent());
  const payday = /palkkapäivänä (\d{1,2}\.\d{1,2}\.)/.exec(plain(await page.locator("#home-now-h").textContent()))?.[1];
  if (!payday) throw new Error("Yhteenveto names no payday");
  film.marks = [await film.box(answer)];
  await film.say(`Yhteenveto: ${shown(left)} is left on payday, ${englishDate(payday)}, after the bills and the everyday spending before it.`);
  await film.glide(film.beside(await film.box(answer.locator(".fig"))));
  await film.read({ poster: true });

  // 5. from the figure to the bills behind it: the figure is the link
  film.marks = [];
  await film.click(answer);
  const list = page.locator("#laskut-taulukko");
  await list.waitFor({ state: "visible" });
  const { month, head } = await billsMonth(list);
  // the page above the table is long: the table scrolls up to the top, and the page back after it
  const monthTop = await month.boundingBox();
  const toTable = monthTop && monthTop.y > SIZE.page - 200 ? Math.round(monthTop.y - 200) : 0;
  if (toTable) await film.scroll(toTable);
  const sum = /** @type {string} */ (head[1]);
  film.marks = [await film.box(month)];
  await film.say(`Laskut (bills): the first month with bills lists them by day, ${shown(sum)} still to pay.`);
  await film.glide(film.beside(/** @type {Box} */ (film.marks[0])));
  await film.read();
  film.marks = [];
  if (toTable) await film.scroll(-toTable);

  // 6. Raportit opens on Tulot ja menot: the complete months' income and spending, and what a usual month costs
  await film.click(tab(page, "Raportit"));
  const strip = page.locator("ul.strip").first();
  await strip.waitFor({ state: "visible" });
  const items = await strip.locator("li").all();
  if (items.length !== 3) throw new Error(`Raportit: the strip has ${items.length} figures, not 3`);
  const [income, spent, usual] = await Promise.all(items.map(async (li) => plain(await li.locator(".fig").textContent())));
  const months = /^Menot, (\d+) kk$/.exec(plain(await /** @type {Locator} */ (items[1]).locator(".strip-label").textContent()))?.[1];
  if (!months) throw new Error("Raportit: the spending figure names no number of months");
  film.marks = [await film.box(strip)];
  await film.say(`Raportit, Tulot ja menot: in ${months} months income was ${shown(/** @type {string} */ (income))} and spending ${shown(/** @type {string} */ (spent))}; a usual month costs ${shown(/** @type {string} */ (usual))}.`);
  // the phone's part follows with no click under this caption
  await film.read({}, 0);
  film.marks = [];
}

/** The phone's screen: Yhteenveto, then a tap on the bills before payday and a scroll to their rows. */
async function phone(/** @type {Film} */ film) {
  const { page } = film;
  await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
  const answer = page.locator('[data-tile="left"]');
  await answer.waitFor({ state: "visible", timeout: 30_000 });
  await film.settle();
  await film.say("The same pages on a phone, with the tabs at the bottom.");
  // a finger's tap has no glide before it
  await film.read({}, CLICK_MS - GLIDE_MS);
  await film.click(answer);
  const list = page.locator("#laskut-taulukko");
  await list.waitFor({ state: "visible" });
  await film.shoot(700);
  // the head of the month of today below the header that scrolls away
  const { month } = await billsMonth(list);
  const top = await month.boundingBox();
  const header = await page.locator("header.topbar").boundingBox();
  if (!top) throw new Error("Laskut on the phone has no month");
  const dy = Math.round(top.y - (header ? Math.max(header.y + header.height, 0) : 0) - 16);
  if (dy > 0) await film.scroll(dy);
  film.marks = [await film.box(month)];
  await film.shoot(1800);
  film.marks = [];
}

/** The step of `shots.mjs`: the computer's part at 1000 px, the phone's at 390 px. */
export default async function step(/** @type {Page} */ page) {
  const dir = process.env.FILM_DIR;
  if (!dir) throw new Error("FILM_DIR is not set: run pnpm readme:film");
  const small = (page.viewportSize()?.width ?? SIZE.width) < 600;
  const film = new Film(page, dir, small);
  if (small) await phone(film);
  else await desk(film);
  await film.save();
}
