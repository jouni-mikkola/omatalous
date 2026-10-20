import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";
import { join } from "node:path";

const FETCH = { "X-Requested-With": "fetch" };

/** Everything a visitor would call "broken": console errors, uncaught errors, failed requests and any 4xx or 5xx. */
export function watch(page: Page): { problems: string[] } {
  const seen = { problems: [] as string[] };
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "assert") seen.problems.push(`console ${m.type()}: ${m.text()} (${m.location().url})`);
  });
  page.on("pageerror", (e) => seen.problems.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => {
    // The app never aborts a request itself, so an aborted GET is one that a reload or navigation cut off.
    // The one POST the page starts by itself is the fetch on open: the server goes on with it whether the page waits or not.
    if ((r.method() === "GET" || /\/api\/sync\/open$/.test(r.url())) && r.failure()?.errorText === "net::ERR_ABORTED") return;
    seen.problems.push(`request failed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) seen.problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  return seen;
}

/**
 * How far the page scrolls sideways, in pixels, once the layout has caught up. A chart is as wide as its container was until
 * its ResizeObserver has run and React has drawn again, so a read right after `setViewportSize` can see a chart stick out of
 * the narrower page for a frame or two. This waits for the fonts and two animation frames, then reads once a frame until two
 * reads in a row agree, two seconds at most (a page that really scrolls sideways agrees at once, with its real figure).
 */
export async function overflow(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const read = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
    // a page that draws no frames (a hidden one) must not hang the test: 100 ms is the longest one frame is waited for
    const frame = () => new Promise<void>((done) => { requestAnimationFrame(() => done()); setTimeout(done, 100); });
    await document.fonts.ready;
    await frame();
    await frame();
    const end = performance.now() + 2000;
    let last = read();
    while (performance.now() < end) {
      await frame();
      const now = read();
      if (now === last) return now;
      last = now;
    }
    return last;
  });
}

async function post(context: BrowserContext, path: string, data: object): Promise<Record<string, any>> {
  const r = await context.request.post(path, { data, headers: FETCH });
  expect(r.ok(), `POST ${path} answered ${r.status()}`).toBe(true);
  return (await r.json()) as Record<string, any>;
}

/**
 * A member with a household of its own, signed in: the state file to open a context with, and the id for `removeMember`.
 * The administrator of the worker's server is there already (run.mjs made it).
 */
export async function makeMember(browser: Browser, username: string): Promise<{ state: string; id: string }> {
  const dir = process.env.E2E_DIR ?? ".";
  const admin = await browser.newContext({ storageState: join(dir, "admin-state.json") });
  const member = await browser.newContext();
  const id = await createMember(admin, member, username);
  await admin.close();
  const state = join(dir, `${username}-state.json`);
  await member.storageState({ path: state });
  await member.close();
  return { state, id };
}

/**
 * The administrator signed in in `admin` makes a member, and `member` (a context nobody is signed in in) signs in as it and
 * changes the temporary password, as a person does at the first visit. The username needs five letters or more. Returns the
 * member's id. `makeMember` and `pnpm shots --member` make a member this way.
 */
export async function createMember(admin: BrowserContext, member: BrowserContext, username: string, displayName = username): Promise<string> {
  const { user, temporaryPassword } = await post(admin, "/api/users", { username, displayName, role: "member" });
  await post(member, "/api/auth/login", { username, password: temporaryPassword });
  await post(member, "/api/auth/password", { current: temporaryPassword, next: `${username}-123456` });
  return user.id;
}

/** The member and what it linked go, so the instance is as the spec found it. */
export async function removeMember(browser: Browser, id: string): Promise<void> {
  const admin = await browser.newContext({ storageState: join(process.env.E2E_DIR ?? ".", "admin-state.json") });
  const gone = await admin.request.delete(`/api/users/${id}`, { headers: FETCH });
  expect(gone.ok(), `DELETE /api/users answered ${gone.status()}`).toBe(true);
  await admin.close();
}

/** The fake bank e2e/server.mjs started: its address, its consent host and the application it accepts. */
export function fakeBank(): { url: string; consentHost: string; appId: string; privateKeyPem: string } {
  if (!process.env.E2E_FAKE_BANK) throw new Error("Run the suite with `pnpm e2e`: it starts the fake bank.");
  return JSON.parse(process.env.E2E_FAKE_BANK);
}

/**
 * Asetukset > Pankkiyhteydet as the signed-in user of `page` does it: the fake bank's application is saved as their own,
 * the bank is picked, the consent page answers, and the page comes back linked. Only the host of the consent page does not
 * exist here; every other request goes where it would in production. `dollars` adds the account in dollars, `own` links the
 * household under ids and a joint account no other link has (fake-bank/household.mjs).
 */
export async function linkFakeBank(page: Page, options: { dollars?: boolean; own?: boolean } = {}): Promise<void> {
  const bank = fakeBank();
  const context = page.context();
  const saved = await context.request.put("/api/bank/credentials", { data: { appId: bank.appId, privateKeyPem: bank.privateKeyPem }, headers: FETCH });
  expect(saved.ok(), `PUT /api/bank/credentials answered ${saved.status()} ${await saved.text()}`).toBe(true);
  // The consent page. The fake bank answers with the redirect to the address it was given, the project's static return page
  // of a plain-http install; the browser would not follow a second answered hop, so that page's job is done here: it
  // sends the browser on to the app with the same query.
  await context.route(`https://${bank.consentHost}/**`, async (route) => {
    const asked = new URLSearchParams([...(options.dollars ? [["dollars", "1"]] : []), ...(options.own ? [["own", "1"]] : [])]).toString();
    const answer = await route.fetch({ url: `${bank.url}${new URL(route.request().url()).pathname}${asked ? `?${asked}` : ""}`, maxRedirects: 0 });
    const back = new URL(answer.headers().location ?? "");
    await route.fulfill({ status: 302, headers: { location: `${process.env.E2E_BASE_URL}/api/connections/callback${back.search}` } });
  });
  await page.goto("/#/settings");
  await page.getByRole("button", { name: /^Yhdistä (toinen )?pankki$/ }).click();
  await page.getByRole("button", { name: "Yhdistä Nordea" }).click();
  // The notice comes after the app's own round trips to the bank (token, accounts), so it takes longer than a page does to
  // draw on a busy machine: wait for the event, not for the usual few seconds.
  await expect(page.locator(".notice").filter({ hasText: "Pankki yhdistetty" })).toBeVisible({ timeout: 30_000 });
}

/**
 * GET /api/meta for a poll that runs while a sync works, or null when the ask failed. The sync's reprocess holds the
 * server's event loop, on a loaded machine longer than the 5 s keep-alive of an idle socket; when it lets go, Node closes
 * that socket before it reads the ask already sent on it (ECONNRESET). A failed ask is a "not yet" and the poll asks again.
 */
export async function metaWhileSyncing(context: BrowserContext): Promise<{ lastSync?: { finishedAt?: string }; accounts: { balanceCents: number | null }[] } | null> {
  try {
    const answer = await context.request.get("/api/meta");
    return answer.ok() ? await answer.json() : null;
  } catch {
    return null;
  }
}

/** Waits for the sync that a link starts to finish, so that every account of the member signed in in `context` has its balance. */
export async function waitForSync(context: BrowserContext): Promise<void> {
  await expect
    .poll(
      async () => {
        const meta = await metaWhileSyncing(context);
        return Boolean(meta?.lastSync?.finishedAt) && meta!.accounts.length > 0 && meta!.accounts.every((a) => a.balanceCents !== null);
      },
      { message: "the sync after linking the fake bank did not finish", timeout: 30_000 },
    )
    .toBe(true);
}

/**
 * The member signed in in `context` says who uses the fake bank's joint account and at what weights, as Asetukset > Tilit
 * does it (PUT /api/accounts/:id/use). Both partners linked the account, so one saying is the real account's for both.
 */
export async function sayJointUse(context: BrowserContext, users: { userId: string; weight: number }[]): Promise<void> {
  const meta = await (await context.request.get("/api/meta")).json();
  const joint = (meta.accounts as { id: string; name: string }[]).find((a) => a.name === "Yhteistili");
  expect(joint, "the fake bank's joint account (Yhteistili) is linked").toBeTruthy();
  const said = await context.request.put(`/api/accounts/${encodeURIComponent(joint!.id)}/use`, { data: { users }, headers: FETCH });
  expect(said.ok(), `PUT /api/accounts/:id/use answered ${said.status()} ${await said.text()}`).toBe(true);
}

/**
 * The header's view switch of the member `userId` as `choice`, in every page `context` opens from now on. The app keeps the
 * choice per user in the browser's storage (App.tsx) and reads it when the page loads, so the page starts in that view.
 */
export async function setScope(context: BrowserContext, userId: string, choice: "own" | "household"): Promise<void> {
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: `scope:${userId}`, value: choice });
}

/** Spaces, no-break spaces and the typographic minus as a reader sees them. */
export const plain = (s: string) => s.replace(/[\s  ]+/g, " ").replace(/−/g, "-").trim();
/** "1 058,40 €" → 105840 */
export const cents = (s: string) => Math.round(Number(plain(s).replace(/[ €≈]/g, "").replace(",", ".")) * 100);

/** The x of the page's column line n (4, 5 or 8): the centre of the gutter after column n of a panel across the 12 columns, as `--split-n` puts it. */
export async function columnLine(page: Page, card: { x: number; width: number }, n: number): Promise<number> {
  const gap = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap")));
  return card.x + (n * (card.width - 11 * gap)) / 12 + (n - 0.5) * gap;
}
