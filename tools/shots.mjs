// @ts-check
/**
 * `pnpm shots <route>... [options]`: screenshots of pages of the built app, for a UI change; `pnpm shots --help` lists the options.
 * Builds first when the build is older than the sources, starts the app on a free port with a temporary data directory
 * (e2e/server.mjs, as `pnpm e2e` does), creates the administrator, loads the demo household and links the fake bank when asked
 * (linkFakeBank of e2e/helpers.ts), makes a second member who links it too when asked (createMember of e2e/helpers.ts), saves one
 * full-page PNG per route and width to $SHOTS_DIR (default shots in $TMPDIR, else /tmp), fails when a picture scrolls sideways or has a
 * table wider than the screen, and stops the app. Needs a Playwright Chromium (PLAYWRIGHT_BROWSERS_PATH).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const WIDTHS = [1280, 1000, 700, 390];
/** The largest part the server takes (apps/server/src/services/account-use.ts). */
const MAX_PART = 100_000_000;
/** The second member `--member` makes: five letters or more in the username, a display name as a household would have. */
const SECOND = { username: "eero-esimerkki", displayName: "Eero" };

export const USAGE = `pnpm shots <route>... [options]    full-page PNGs of the built app, one per route and width
  <route>          a page id with an optional query: overview, "reports?tab=income". Several routes share one app start and one login
  --widths a,b     pixel widths (default ${WIDTHS.join(",")})
  --demo           the demo household: 14 months of made-up rows on its own accounts (--demo-years: 26, both sides of a year comparison)
  --fake-bank      links the fake bank (e2e/fake-bank/): a checking and a savings account, a joint account of MEIKALAINEN MATTI;KORHONEN ELISA,
                   an ESIMERKKIPANKKI card with a 3 000 EUR limit and its bill. With --demo the demo's accounts are there as well
  --answers f.mjs  default export { "/api/dashboard": (answer) => changed answer }: the page shows the changed answer, so a state no
                   household has can be shown. Fails when nothing asked for a path. Example: tools/shots-examples/answers.mjs
                   Or { fail: { status: 503, body: { error: "..." } } } (the server's error) or { hold: true } (never answered: loading)
  --steps f.mjs    default export async (page, route) => {}, run for every picture after the page has loaded, before the picture
                   (open a row, pick a month, switch a view). Example: tools/shots-examples/steps.mjs
  --scope own|household
                   the header's view switch, set before the page loads. It shows only when the household has a shared account
                   (a second member, see --member); without one, or to click it yourself, use --steps
  --member         needs --fake-bank. A second member, Eero, links the fake bank too: the joint account has two users, the switch
                   shows and --scope has something to show. The pictures are the first member's
  --parts a:b      needs --member. The first member says, as Asetukset > Tilit does, that the joint account is used by the two at
                   a:b euros a month (60:40 is 60 % and 40 %); without it the bank's own answer stands: both members and the
                   other holder, a third each
  --loan           needs --member. The second member saves the mortgage the joint account's payments propose, so the first member
                   sees a loan another member typed in
  --name label     in the file names: <route>-<label>-<width>.png, so two states do not overwrite each other
  --only "x"       a CSS selector or heading text, found on the page the steps end on: a second picture of that part (with what stands outside it, no sticky bar)
                   beside the whole page: <route>-<label>-<slug of x>-<width>.png; exit 1 when nothing matches. E.g. --only "Säännöt" or "#saannot"
  --look night|light night puts data-look="night" on <html>, light takes it away (before the steps and the picture); without it the page is as served
Pictures go to $SHOTS_DIR (default shots in $TMPDIR, else /tmp); $SHOTS_DISPLAY_NAME is the administrator's name on the page (default Shots). Exit 1 when a picture scrolls sideways or a table is wider than the screen.`;

/** @typedef {((answer: any) => unknown) | { fail: { status: number, body: object } } | { hold: true }} AnswerSpec */

/**
 * @typedef {{ help: boolean, routes: string[], widths: number[], demo: boolean, demoYears: boolean, fakeBank: boolean, answers: string | null,
 *   steps: string | null, scope: "own" | "household" | null, name: string | null, member: boolean, parts: [number, number] | null,
 *   loan: boolean, only: string | null, look: "night" | "light" | null }} Options
 */

/**
 * @param {string[]} argv
 * @returns {Options}
 */
export function parseArgs(argv) {
  /** @type {Options} */
  const o = { help: false, routes: [], widths: WIDTHS, demo: false, demoYears: false, fakeBank: false, answers: null, steps: null, scope: null, name: null, member: false, parts: null, loan: false, only: null, look: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    /** The value of an option: after the `=`, else the next argument. */
    const value = () => (eq > 0 ? a.slice(eq + 1) : (argv[++i] ?? ""));
    const file = () => {
      const v = value();
      if (!v || v.startsWith("-")) throw new Error(`${flag} takes the path of a .mjs file (got: ${v || "nothing"})`);
      return v;
    };
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--demo") o.demo = true;
    else if (a === "--demo-years") o.demoYears = true;
    else if (a === "--fake-bank") o.fakeBank = true;
    else if (a === "--member") o.member = true;
    else if (a === "--loan") o.loan = true;
    else if (flag === "--widths") {
      const v = value();
      o.widths = v.split(",").map(Number);
      if (o.widths.some((w) => !Number.isInteger(w) || w < 200 || w > 4000)) throw new Error(`--widths takes pixel widths like 390,1366 (got: ${v})`);
    } else if (flag === "--answers") o.answers = file();
    else if (flag === "--steps") o.steps = file();
    else if (flag === "--scope") {
      const v = value();
      if (v !== "own" && v !== "household") throw new Error(`--scope takes own or household (got: ${v})`);
      o.scope = v;
    } else if (flag === "--parts") {
      const v = value();
      const m = /^(\d{1,9}):(\d{1,9})$/.exec(v);
      if (!m || Number(m[1]) + Number(m[2]) === 0 || Number(m[1]) > MAX_PART || Number(m[2]) > MAX_PART) throw new Error(`--parts takes two whole numbers, not both 0, like 60:40 (got: ${v})`);
      o.parts = [Number(m[1]), Number(m[2])];
    } else if (flag === "--name") {
      const v = value();
      if (!/^[\w-]+$/.test(v)) throw new Error(`--name takes letters, digits, - and _ (got: ${v})`);
      o.name = v;
    } else if (flag === "--only") {
      const v = value().trim();
      if (!v || v.startsWith("--")) throw new Error(`--only takes a CSS selector or the text of a panel's heading (got: ${v || "nothing"})`);
      o.only = v;
    } else if (flag === "--look") {
      const v = value();
      if (v !== "night" && v !== "light") throw new Error(`--look takes night or light (got: ${v})`);
      o.look = v;
    } else if (a.startsWith("-")) throw new Error(`unknown option ${a} (pnpm shots --help lists them)`);
    else {
      const route = a.replace(/^#?\/?/, "");
      if (!/^[a-z][a-z-]*(\?[\w=&%.-]*)?$/.test(route)) throw new Error(`a route is a page id with an optional query, like overview or reports?tab=income (got: ${route})`);
      if (!o.routes.includes(route)) o.routes.push(route);
    }
  }
  if (!o.help && !o.routes.length) throw new Error("usage: pnpm shots <route>... [options] (pnpm shots --help lists them)");
  if (!o.help && o.member && !o.fakeBank) throw new Error("--member needs --fake-bank: the second member links the fake bank");
  if (!o.help && !o.member && (o.parts || o.loan)) throw new Error(`${o.parts ? "--parts" : "--loan"} needs --member: it is about the second member`);
  return o;
}

/** The file of one picture: the route, the label of `--name` when there is one, and the width. */
export function shotName(/** @type {string} */ route, /** @type {string | null} */ name, /** @type {number} */ width) {
  return `${[route.replace(/[?=&%]+/g, "-"), name].filter(Boolean).join("-")}-${width}.png`;
}

/** The file of a `--only` picture: like the whole page's, with the slug of the selector or heading between the label and the width. */
export function partName(/** @type {string} */ route, /** @type {string | null} */ name, /** @type {string} */ only, /** @type {number} */ width) {
  return shotName(route, [name, onlySlug(only)].filter(Boolean).join("-"), width);
}

/** The part of a file name that stands for a `--only` selector or heading text: letters and digits, the rest as single dashes. */
export function onlySlug(/** @type {string} */ only) {
  return only.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "part";
}

/**
 * Marks the element `--only` means and returns whether there is one: the first match of the text as a CSS selector, else the card
 * (or section) of the first heading whose text is the text (else one that contains it, case aside).
 */
export function markOnly(/** @type {string} */ only) {
  document.querySelectorAll("[data-shots-only]").forEach((e) => e.removeAttribute("data-shots-only"));
  /** @type {Element | null} */
  let hit = null;
  try {
    hit = document.querySelector(only);
  } catch {
    hit = null;
  }
  if (!hit) {
    const want = only.trim().toLowerCase();
    const heads = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, .card-name, .card-head"));
    const text = (/** @type {Element} */ e) => (e.textContent ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    const head = heads.find((e) => text(e) === want) ?? heads.find((e) => text(e).includes(want));
    hit = head ? (head.closest(".card, section, article") ?? head) : null;
  }
  hit?.setAttribute("data-shots-only", "");
  return hit !== null;
}

/**
 * Makes the page ready for a whole-page picture, in the tool's browser only: the page is at its top (an address with an anchor
 * scrolls it, and a sticky rail would be drawn where it stopped), and what is fixed to the bottom of the screen (the phone form's
 * bar) gets its height as room under the page, so the page's end is not hidden under it.
 */
export function readyForPicture() {
  window.scrollTo(0, 0);
  // an animation a step or a late draw started (a chart's wipe) is run to its end, as the screenshot's own option does later
  for (const a of document.getAnimations()) if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish();
  let room = 0;
  for (const e of Array.from(document.body.querySelectorAll("*"))) {
    if (getComputedStyle(e).position !== "fixed") continue;
    const r = e.getBoundingClientRect();
    if (r.height > 0 && r.height <= 120 && r.width >= window.innerWidth * 0.9 && r.bottom >= window.innerHeight - 1) room = Math.max(room, Math.ceil(r.height));
  }
  if (room) document.body.style.paddingBottom = `calc(${getComputedStyle(document.body).paddingBottom} + ${room}px)`;
}

/**
 * The box of the marked `--only` part, in page coordinates: the element together with its visible descendants that stand outside
 * it (an opened menu is positioned out of its element). What a scrolling or clipping descendant holds beyond its own edge is left out.
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function partBox() {
  const root = document.querySelector("[data-shots-only]");
  if (!root) return null;
  const r0 = root.getBoundingClientRect();
  let [left, top, right, bottom] = [r0.left, r0.top, r0.right, r0.bottom];
  /** @param {Element} e */
  const walk = (e) => {
    for (const c of Array.from(e.children)) {
      const s = getComputedStyle(c);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
      const r = c.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) {
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      }
      if (s.overflowX === "visible" && s.overflowY === "visible") walk(c);
    }
  };
  walk(root);
  return { x: left + window.scrollX, y: top + window.scrollY, width: right - left, height: bottom - top };
}

/**
 * Before a part picture: what sticks to the screen (the top bar, the phone's tab bar) and is not the part, nor holds it, nor sits in
 * it, is taken out of sight, so that it is not drawn across the middle of a part that is taller than the screen.
 */
export function hideStuck() {
  const root = document.querySelector("[data-shots-only]");
  for (const e of Array.from(document.body.querySelectorAll("*"))) {
    const p = getComputedStyle(e).position;
    if ((p === "sticky" || p === "fixed") && root && !root.contains(e) && !e.contains(root)) /** @type {HTMLElement} */ (e).style.visibility = "hidden";
  }
}

/**
 * The paths of the API and what changes their answers, from the default export of an `--answers` module.
 * A value is a function from the answer to the one to show, `{ fail: { status, body } }` (an error answer) or `{ hold: true }`.
 * @param {unknown} mod
 * @returns {Record<string, AnswerSpec>}
 */
export function answerTable(mod, file = "the answers module") {
  const table = /** @type {{ default?: unknown }} */ (mod)?.default;
  if (!table || typeof table !== "object" || Array.isArray(table)) throw new Error(`${file}: the default export is an object from an API path to a function, like { "/api/dashboard": (answer) => answer }`);
  for (const [path, change] of Object.entries(table)) {
    if (!/^\/api\/[\w/.-]+$/.test(path)) throw new Error(`${file}: "${path}" is no path of the API (like /api/dashboard, without the query)`);
    if (typeof change === "function") continue;
    const spec = /** @type {any} */ (change);
    const failing = spec && typeof spec === "object" && "fail" in spec;
    if (failing) {
      const { status, body } = spec.fail ?? {};
      if (!Number.isInteger(status) || status < 400 || status > 599) throw new Error(`${file}: fail of ${path} takes a status from 400 to 599, like { fail: { status: 503, body: { error: "..." } } }`);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`${file}: fail of ${path} takes the body the server sends, an object like { error: "..." }`);
    } else if (!(spec && typeof spec === "object" && spec.hold === true)) {
      throw new Error(`${file}: the value of ${path} is a function from the answer to the answer to show, { fail: { status, body } } or { hold: true }`);
    }
  }
  return /** @type {Record<string, AnswerSpec>} */ (table);
}

/**
 * The function of a `--steps` module.
 * @param {unknown} mod
 * @returns {(page: import("@playwright/test").Page, route: string) => Promise<void> | void}
 */
export function stepsFunction(mod, file = "the steps module") {
  const run = /** @type {{ default?: unknown }} */ (mod)?.default;
  if (typeof run !== "function") throw new Error(`${file}: the default export is a function, async (page, route) => {}`);
  return /** @type {any} */ (run);
}

/** @param {string} file a path, relative to the directory the command runs in */
async function load(file) {
  if (!existsSync(file)) throw new Error(`${file} does not exist`);
  return import(pathToFileURL(resolve(file)).href);
}

/** True when the build is missing or older than the newest source file. */
function stale() {
  const built = [join(ROOT, "apps/server/dist/node.js"), join(ROOT, "apps/web/dist/index.html")];
  if (!built.every(existsSync)) return true;
  const oldest = Math.min(...built.map((f) => statSync(f).mtimeMs));
  /** @param {string} d @returns {number} */
  const newest = (d) => readdirSync(d, { withFileTypes: true }).reduce((m, e) => (e.name === "node_modules" || e.name === "dist" ? m : Math.max(m, e.isDirectory() ? newest(join(d, e.name)) : statSync(join(d, e.name)).mtimeMs)), 0);
  return ["apps/web/src", "apps/web/public", "apps/server/src", "packages/core/src"].some((d) => newest(join(ROOT, d)) > oldest) || statSync(join(ROOT, "apps/web/index.html")).mtimeMs > oldest;
}

/** What `--look` does inside the page: `night` puts the attribute on <html>, `light` is the look without it. */
export function applyLook(/** @type {"night" | "light"} */ look) {
  const root = document.documentElement;
  if (look === "night") root.setAttribute("data-look", "night");
  else root.removeAttribute("data-look");
}

/** How a picture is taken: finite animations and transitions are run to their end (a button that is moving from one look to the other is not a state), infinite ones stand at their start. */
export function pictureOptions(/** @type {string} */ path) {
  return { path, fullPage: true, animations: /** @type {const} */ ("disabled") };
}

/** Waits for the page to stop loading: the requests are done and the "Ladataan…" text is gone; with a held answer, until the page has asked for it and drawn what it draws meanwhile. */
async function settle(/** @type {import("@playwright/test").Page} */ page, held = () => 0, wanted = 0) {
  if (wanted) {
    await page.waitForLoadState("load");
    for (let i = 0; i < 150 && held() < wanted; i++) await page.waitForTimeout(100);
    return void (await page.waitForTimeout(500));
  }
  await page.waitForLoadState("networkidle");
  await page.getByText("Ladataan…").waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return console.log(USAGE);
  // the modules first: a typo in a file name should not cost a build and a start
  const answers = o.answers ? answerTable(await load(o.answers), o.answers) : null;
  const steps = o.steps ? stepsFunction(await load(o.steps), o.steps) : null;
  if (stale()) {
    console.log("shots: the build is older than the sources, building");
    if (spawnSync("pnpm", ["build"], { cwd: ROOT, stdio: "inherit" }).status !== 0) throw new Error("pnpm build failed");
  }
  const { startServer } = await import("../e2e/server.mjs");
  const { createMember, linkFakeBank, sayJointUse, setScope, waitForSync } = await import("../e2e/helpers.ts");
  const { chromium, expect } = await import("@playwright/test");
  const out = process.env.SHOTS_DIR ?? join(tmpdir(), "shots");
  mkdirSync(out, { recursive: true });
  // SHOTS_STILL=1 (tools/visual-check.sh): no animation is caught half way, so two runs give the same pixels
  const still = process.env.SHOTS_STILL === "1" ? { reducedMotion: /** @type {const} */ ("reduce") } : {};
  const app = await startServer();
  /** @type {import("@playwright/test").Browser | undefined} */
  let browser;
  let bad = 0;
  try {
    // the browser's own chrome (the date field's mm/dd/yyyy) takes its language from the environment, not from the context's locale
    browser = await chromium.launch({ env: { ...process.env, LANG: "fi_FI.UTF-8", LANGUAGE: "fi" }, ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}) });
    const context = await browser.newContext({ locale: "fi-FI", timezoneId: "Europe/Helsinki", baseURL: app.base, ...still });
    const call = async (/** @type {string} */ path, /** @type {object} */ data = {}) => {
      const r = await context.request.post(`${app.base}${path}`, { data, headers: { "X-Requested-With": "fetch" } });
      if (!r.ok()) throw new Error(`POST ${path} answered ${r.status()}: ${(await r.text()).slice(0, 200)}`);
      return r.json().catch(() => null);
    };
    const { user } = await call("/api/auth/setup", { code: app.setupCode, username: "shots", displayName: process.env.SHOTS_DISPLAY_NAME || "Shots", password: "shots-salasana-123456" });
    await call("/api/admin/instance/complete");
    if (o.demo) await call(o.demoYears ? "/api/demo?months=26" : "/api/demo");
    if (o.fakeBank) {
      // linkFakeBank reads the app's address and the bank's application from the environment, as the specs get them from run.mjs
      Object.assign(process.env, { E2E_BASE_URL: app.base, E2E_FAKE_BANK: app.fakeBank });
      const linking = await context.newPage();
      await linkFakeBank(linking);
      await linking.close();
      // the sync the link starts runs on: the pictures wait until it has read every account
      await waitForSync(context);
      if (o.member) {
        // a second member of the household links the bank too; both copies of the joint account are one real account
        const second = await browser.newContext({ locale: "fi-FI", timezoneId: "Europe/Helsinki", baseURL: app.base, ...still });
        const secondId = await createMember(context, second, SECOND.username, SECOND.displayName);
        const secondLinking = await second.newPage();
        await linkFakeBank(secondLinking);
        await secondLinking.close();
        await waitForSync(second);
        // the page sends the euros it is given as cents: the weights are cents a month
        if (o.parts) await sayJointUse(context, [{ userId: user.id, weight: o.parts[0] * 100 }, { userId: secondId, weight: o.parts[1] * 100 }]);
        if (o.loan) {
          // what the second member's own view proposes from the joint account's payments, saved as they would save it
          const { proposals } = await (await second.request.get("/api/loans/proposals")).json();
          const [proposal, ...rest] = proposals;
          if (!proposal || rest.length) throw new Error(`--loan wants one proposed loan from the fake bank's payments and the second member has ${proposals.length}`);
          const { today } = await (await second.request.get("/api/meta")).json();
          const saved = await second.request.post("/api/loans", {
            headers: { "X-Requested-With": "fetch" },
            data: {
              name: "Asuntolaina", lender: proposal.payee, kind: "mortgage", grantedCents: 15_000_000, balanceCents: 12_000_000, balanceDate: today, rateBp: 400, reference: null,
              marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: proposal.paymentCents, endDate: null, limitCents: null, seriesKey: proposal.key,
            },
          });
          if (!saved.ok()) throw new Error(`POST /api/loans answered ${saved.status()}: ${(await saved.text()).slice(0, 200)}`);
        }
        console.log(`shots: ${SECOND.displayName} is a second member and linked the fake bank${o.loan ? ", saved a loan" : ""}${o.parts ? `; the joint account is used ${o.parts.join(":")}` : ""}`);
      }
    }
    if (o.scope) await setScope(context, user.id, o.scope);
    const holding = Object.values(answers ?? {}).filter((c) => typeof c !== "function" && "hold" in c).length;
    let heldAsks = 0;
    /** The paths whose answer was changed at least once. */
    const changed = new Set();
    if (answers) {
      await context.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const change = Object.hasOwn(answers, path) ? answers[path] : undefined;
        if (!change) return route.fallback();
        if (typeof change !== "function") {
          changed.add(path);
          // a held answer is left pending: the page closes with the picture
          if ("hold" in change) heldAsks++;
          return "hold" in change ? undefined : route.fulfill({ status: change.fail.status, json: change.fail.body });
        }
        const response = await route.fetch();
        const answer = await response.json().catch(() => undefined);
        if (answer === undefined) return route.fulfill({ response });
        changed.add(path);
        await route.fulfill({ response, json: (await change(answer)) ?? answer });
      });
    }
    /** The address each picture ended at, by width: two routes that end at one address are one page. */
    const landedAt = new Map();
    for (const route of o.routes) {
      for (const width of o.widths) {
        const page = await context.newPage();
        await page.setViewportSize({ width, height: 900 });
        heldAsks = 0;
        await page.goto(`/#/${route}`);
        await settle(page, () => heldAsks, holding);
        if (o.look) await page.evaluate(applyLook, o.look);
        if (steps) {
          await steps(page, route);
          await settle(page, () => heldAsks, holding);
        }
        // the app may have sent the route to another address (the rules are a part of Tapahtumat): a second route that ends at the same address is the same page
        const landed = new URL(page.url()).hash.slice(1).split("#")[0];
        const twin = landedAt.get(`${width} ${landed}`);
        landedAt.set(`${width} ${landed}`, twin ?? route);
        await page.evaluate(readyForPicture);
        const file = join(out, shotName(route, o.name, width));
        // a click in a step leaves the pointer on its key, and a key under the pointer is drawn in its hover colour
        await page.mouse.move(0, 0);
        // the whole page first: with --only the part is a second file, and the bar is hidden only for it
        await page.screenshot(pictureOptions(file));
        let shown = file;
        if (o.only) {
          // the part is looked for on the page the steps ended on
          if (!(await page.evaluate(markOnly, o.only))) throw new Error(`--only "${o.only}": nothing on ${route} at ${width}px (the page ${page.url().split("#")[1] ?? ""}) matches it as a CSS selector or as the text of a heading`);
          const box = await page.evaluate(partBox);
          if (!box || box.width <= 0 || box.height <= 0) throw new Error(`--only "${o.only}": the part on ${route} at ${width}px has no size`);
          await page.evaluate(hideStuck);
          shown = join(out, partName(route, o.name, o.only, width));
          const x = Math.max(0, box.x - 16);
          const y = Math.max(0, box.y - 16);
          await page.screenshot({ ...pictureOptions(shown), clip: { x, y, width: box.x + box.width + 16 - x, height: box.y + box.height + 16 - y } });
        }
        const m = await page.evaluate(() => ({
          over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          tables: Array.from(document.querySelectorAll("table")).filter((t) => t.getBoundingClientRect().width > window.innerWidth + 1).length,
        }));
        const ok = m.over <= 1 && m.tables === 0;
        if (!ok) bad++;
        if (twin && twin !== route && !o.only) console.log(`shots: ${route} at ${width}px is the same page as ${twin}: the app sent both to ${landed}; --only takes the part that differs`);
        console.log(`shots: ${route} at ${width}px ${shown === file ? file : `${file} and the part ${shown}`} ${ok ? "no horizontal scroll" : `SCROLLS SIDEWAYS (${m.over}px over, ${m.tables} tables wider than the screen)`}`);
        await page.close();
      }
    }
    const unused = Object.keys(answers ?? {}).filter((path) => !changed.has(path));
    if (unused.length) {
      bad++;
      console.log(`shots: no picture shows the answer for ${unused.join(", ")}: no page asked for it, or what it answered was not JSON`);
    }
  } finally {
    await browser?.close();
    app.stop();
  }
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`shots: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
