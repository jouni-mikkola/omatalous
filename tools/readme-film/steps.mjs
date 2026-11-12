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
/** How long a caption stays for each word in it, and at least. */
const READ_MS = { word: 200, least: 2400 };
const NUMBERS = ["no", "one", "two", "three"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const KUUT = ["tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu", "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu"];

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

/** The English month of a Finnish heading such as "Marraskuu 2026". */
export function englishMonth(/** @type {string} */ heading) {
  const at = KUUT.indexOf(heading.trim().split(/\s+/)[0]?.toLowerCase() ?? "");
  if (at < 0) throw new Error(`no month in "${heading}"`);
  return /** @type {string} */ (MONTHS[at]);
}

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
  }

  /** Holds the page as it is for as long as its caption takes to read. */
  async read(/** @type {Partial<Record>} */ extra = {}) {
    await this.shoot(Math.max(READ_MS.least, this.caption.split(/\s+/).length * READ_MS.word), extra);
  }

  /** The pointer glides to a point, a frame at each step. */
  async glide(/** @type {{ x: number, y: number }} */ to, ms = 480) {
    const from = this.pointer ?? to;
    const n = Math.max(1, Math.round(ms / STEP_MS));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.pointer = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      await this.page.mouse.move(this.pointer.x, this.pointer.y);
      await this.shoot(STEP_MS);
    }
  }

  /** Where the pointer rests while a box is read: at its lower right corner, off the text. */
  beside(/** @type {Box} */ box) {
    const limit = this.phone ? PHONE : { width: SIZE.width, height: SIZE.page };
    return { x: Math.min(limit.width - 24, Math.round(box.x + box.width + 10)), y: Math.min(limit.height - 24, Math.round(box.y + box.height - 4)) };
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
   * caption of one page over another.
   */
  async click(/** @type {Locator} */ target) {
    const at = await this.centre(target);
    if (this.phone) this.pointer = null;
    else await this.glide(at);
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

/** The computer's screen: from the empty first page to one figure of Raportit and the rows behind it. */
async function desk(/** @type {Film} */ film) {
  const { page } = film;
  await page.setViewportSize({ width: SIZE.width, height: SIZE.page });
  film.pointer = { x: 760, y: 560 };
  await page.mouse.move(film.pointer.x, film.pointer.y);

  // 1. the empty first page; the example data stands in for a bank
  const load = page.getByRole("button", { name: "Lataa esimerkkitiedot" });
  await load.waitFor({ state: "visible", timeout: 30_000 });
  await film.settle();
  await film.say("A new install is empty. Here the example data stands in for a linked bank.");
  await film.read();
  await film.click(load);
  await page.getByRole("heading", { name: /^Palkkapäivään/ }).waitFor({ state: "visible", timeout: 30_000 });
  await film.settle();
  await film.shoot(300);

  // 2. the rows that came in
  await film.click(tab(page, "Tapahtumat"));
  const count = plain(await page.locator(".tx-totals-count").textContent());
  const span = plain(await page.locator(".tx-totals-span").textContent());
  const rows = /^(\d[\d ]*) tapahtumaa$/.exec(count)?.[1]?.replace(/ /g, "");
  const dates = /(\d{1,2}\.\d{1,2}\.\d{4})–(\d{1,2}\.\d{1,2}\.\d{4})$/.exec(span);
  if (!rows || !dates) throw new Error(`Tapahtumat shows "${count}" and "${span}"`);
  await film.say(`Tapahtumat: ${rows} transactions, ${englishDate(/** @type {string} */ (dates[1]))} to ${englishDate(/** @type {string} */ (dates[2]))}, each with a payee and a category.`);
  await film.read();

  // 3. one row: the bank's text, the payee and the category the app gave it
  const visible = page.locator("tbody tr").filter({ has: page.locator(".tx-text") });
  let picked = null;
  for (const row of await visible.all()) {
    const name = plain(await row.locator(".tx-name").textContent());
    const text = plain(await row.locator(".tx-text").textContent());
    const category = plain(await row.locator(".tx-chip-label").textContent().catch(() => ""));
    const box = await row.boundingBox();
    if (!box || box.y + box.height > SIZE.page) break;
    if (category && category !== "Omat siirrot" && text.length > name.length + 4 && !text.toUpperCase().startsWith(name.toUpperCase())) {
      picked = { row, name, text, category };
      break;
    }
  }
  if (!picked) throw new Error("no row on the first screen of Tapahtumat whose bank text differs from its payee");
  film.marks = [await film.box(picked.row.locator(".tx-text"), picked.row.locator(".tx-name")), await film.box(picked.row.locator(".tx-chip-label"))];
  await film.say(`The bank's text ${picked.text} becomes the payee ${picked.name}, category ${picked.category}.`);
  await film.glide(film.beside(/** @type {Box} */ (film.marks[1])));
  await film.read();
  film.marks = [];

  // 4. Yhteenveto: the balance less the bills before payday
  await film.click(tab(page, "Yhteenveto"));
  const answer = page.locator(".home-answer");
  await answer.waitFor({ state: "visible" });
  const figure = async (/** @type {string} */ term) => plain(await answer.locator("dl > div").filter({ has: page.locator("dt", { hasText: term }) }).locator("dd").textContent());
  const balance = await figure("Käyttötilin saldo");
  const bills = await figure("Maksut ennen palkkapäivää");
  const left = await figure("Jää");
  const payday = /Palkkapäivään (\d{1,2}\.\d{1,2}\.) jää/.exec(plain(await answer.locator("h2").textContent()))?.[1];
  if (!payday) throw new Error("Yhteenveto names no payday");
  if (cents(balance) + cents(bills) !== cents(left)) throw new Error(`Yhteenveto: ${balance} and ${bills} do not make ${left}`);
  film.marks = [await film.box(answer.locator("dl"))];
  await film.say(`Yhteenveto: ${euros(cents(balance))} on the current account less ${euros(-cents(bills))} of bills before payday (${englishDate(payday)}) leaves ${euros(cents(left))}.`);
  await film.glide(film.beside(await film.box(answer.locator("dd").first())));
  await film.read({ poster: true });

  // 5. from the figure to the bills behind it
  await film.click(answer.locator('a[href*="ennen-palkkapaivaa"]'));
  const list = page.locator("#ennen-palkkapaivaa .bp-rows");
  await list.waitFor({ state: "visible" });
  const due = [];
  for (const row of await list.locator('.bp-row[data-kind="bill"]').all()) {
    due.push({ name: plain(await row.locator(".bp-name").textContent()), date: plain(await row.locator(".bp-date").textContent()), sum: cents(plain(await row.locator(".bp-sum").textContent())) });
  }
  const total = list.locator('.bp-row[data-kind="total"]');
  const totalCents = cents(plain(await total.textContent()));
  if (!due.length || due.reduce((s, b) => s + b.sum, 0) !== totalCents || totalCents !== -cents(bills)) throw new Error(`Laskut: the bills before payday do not add up to ${bills}`);
  film.marks = [await film.box(list.locator('.bp-row[data-kind="bill"]').first(), total)];
  // two bills are named; more would make the caption too long to read in the film's 40 seconds
  const named = due.length <= 2 ? `, ${due.map((b) => `${b.name} ${euros(b.sum)} on ${englishDate(b.date)}`).join(" and ")}` : "";
  await film.say(`Laskut: the ${euros(totalCents)} is ${NUMBERS[due.length] ?? due.length} bill${due.length === 1 ? "" : "s"} expected before payday${named}.`);
  await film.glide(film.beside(/** @type {Box} */ (film.marks[0])));
  await film.read();
  film.marks = [];

  // 6. Raportit: the days of the month so far by category, against what those days usually cost (core expectedFor)
  await film.click(tab(page, "Raportit"));
  const heading = page.getByRole("heading", { level: 2 }).filter({ hasText: /^\p{L}+ \d{4}$/u }).first();
  await heading.waitFor({ state: "visible" });
  const sums = plain(await page.locator("p", { hasText: /^Menot/ }).first().textContent());
  const m = /^Menot ([\d ]+ €), yleensä ([\d ]+ €)/.exec(sums);
  if (!m) throw new Error(`Raportit says "${sums}"`);
  const range = plain(await page.getByText(/^\d{1,2}\.(?:–\d{1,2}\.)?\d{1,2}\.$/).first().textContent());
  const d = /^(\d{1,2})\.(?:–(\d{1,2})\.)?\d{1,2}\.$/.exec(range);
  if (!d) throw new Error(`Raportit names no days: "${range}"`);
  const month = englishMonth(plain(await heading.textContent()));
  const days = d[2] ? `${month} ${d[1]} to ${d[2]}` : `${month} ${d[1]}`;
  await film.say(`Raportit: ${days} by category, ${m[1]} spent against a usual ${m[2]} for those days.`);
  await film.read();

  // 7. one figure of it and the rows behind it
  const buttons = page.getByRole("button", { name: /^Näytä tapahtumat: / });
  // the groceries when the month has them: a category every household has
  const grocery = page.getByRole("button", { name: /^Näytä tapahtumat: Ruokakauppa / });
  const open = (await grocery.count()) ? grocery.first() : buttons.first();
  const clicked = cents(plain(await open.textContent()));
  await film.click(open);
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor({ state: "visible" });
  const lines = await dialog.locator("tbody tr").all();
  let added = 0;
  for (const line of lines) added += cents(plain(await line.locator("td.num").textContent()));
  const shown = cents(plain(await dialog.locator("[data-why-total]").textContent()));
  if (added !== shown || shown !== clicked) throw new Error(`Raportit: the rows add up to ${euros(added)}, the dialog shows ${euros(shown)}, the figure was ${euros(clicked)}`);
  const category = plain(await dialog.locator("h2").textContent());
  film.marks = [await film.box(dialog.locator(".why-foot"))];
  await film.say(`The ${euros(shown)} of ${category} opens its ${lines.length} rows, which add up to the same sum.`);
  await film.glide(film.beside(/** @type {Box} */ (film.marks[0])));
  await film.read();
  film.marks = [];
}

/** The phone's screen: Yhteenveto, then a tap on the bills before payday and a scroll to their rows. */
async function phone(/** @type {Film} */ film) {
  const { page } = film;
  await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
  const answer = page.locator(".home-answer");
  await answer.waitFor({ state: "visible", timeout: 30_000 });
  await film.settle();
  await film.say("On a phone the same pages fit the screen, with the tabs at the bottom.");
  await film.read();
  await film.click(answer.locator('a[href*="ennen-palkkapaivaa"]'));
  const list = page.locator("#ennen-palkkapaivaa .bp-rows");
  await list.waitFor({ state: "visible" });
  await film.shoot(800);
  // the bills and their total above the tab bar at the bottom of the screen
  const total = list.locator('.bp-row[data-kind="total"]');
  const bar = await page.getByRole("navigation", { name: "Päävalikko" }).boundingBox();
  const end = await total.boundingBox();
  if (!bar || !end) throw new Error("Laskut on the phone has no tab bar or no total");
  const dy = Math.round(end.y + end.height - (bar.y - 24));
  if (dy > 0) await film.scroll(dy);
  film.marks = [await film.box(list.locator('.bp-row[data-kind="bill"]').first(), total)];
  await film.shoot(2000);
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
