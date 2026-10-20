import { expect, type Page, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Asetukset > Ylläpito. The host helper is played by the app's own `ops` CLI on the same data
// directory, which is how the real helper talks to it (scripts/ops-helper.sh).
const ADMIN_PASSWORD = "e2e-salasana-123456";
const DIR = process.env.E2E_DIR ?? ".";
const STATE = join(DIR, "admin-state.json");
const XSS = ["<script>window.__xss = 1</script>", "<img src=x onerror=\"window.__xss = 2\">", "javascript:window.__xss = 3"];

function helper(args: string[], stdin = ""): Record<string, any> {
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(DIR, "app", "node.js"), "ops", ...args], {
    input: stdin,
    encoding: "utf8",
    env: {
      ...process.env,
      DATA_DIR: join(DIR, "data"),
      APP_SECRET_FILE: join(DIR, "secrets", "app_secret"),
      MIGRATIONS_DIR: join(process.cwd(), "apps/server/migrations"),
      INDUSTRY_LOOKUP: "false",
    },
  });
  if (r.status !== 0) throw new Error(`ops ${args[0]} failed: ${r.stderr}`);
  // the contract: one JSON object on stdout and nothing else
  const lines = r.stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!);
}

/** The per-minute limit on mutating requests would make the test wait; move the earlier requests back in time. */
function ageRequests() {
  const db = new DatabaseSync(join(DIR, "data", "banking.db"));
  try {
    db.exec("UPDATE ops_requests SET requested_at = '2020-01-01T00:00:00.000Z'");
  } finally {
    db.close();
  }
}

const problems = (page: Page) => {
  const seen: string[] = [];
  page.on("pageerror", (e) => seen.push(`page error: ${e.message}`));
  page.on("console", (m) => (m.type() === "error" ? seen.push(`console: ${m.text()}`) : undefined));
  return seen;
};

test.describe.configure({ mode: "serial" });

test("maintenance page: helper missing, then working; XSS strings stay text; update flow end to end", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = problems(page);
  page.on("dialog", (d) => {
    seen.push(`unexpected dialog: ${d.message()}`);
    void d.dismiss();
  });

  // reachable from Asetukset > Tekniset asetukset
  await page.goto("/#/settings");
  await page.getByRole("link", { name: "Avaa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ylläpito" }).first()).toBeVisible();

  // no helper yet: a clear state, the command to enable it, and no way to queue anything
  // (Palvelin > Etäkäyttö on the same page says the same, so the words are looked for in the Ylläpito card)
  const maintenance = page.locator("#yllapito");
  await expect(maintenance.getByText("Ylläpitoapuri ei ole käytössä")).toBeVisible();
  await expect(maintenance.getByText("./scripts/install.sh --ops-helper")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tarkista päivitykset" })).toBeDisabled();
  // without the helper the page is the notice, the version and the reset; the controls that cannot work are not drawn
  await expect(page.getByRole("heading", { name: "Versio" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tyhjennä kaikki tiedot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ota varmuuskopio nyt" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lue lokit" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Palauta uusin varmuuskopio" })).toHaveCount(0);

  // the helper reports in, with a snapshot full of hostile strings
  helper(
    ["state", "--helper", "1"],
    JSON.stringify({
      version: "0.4.0",
      commit: "abc1234",
      update_available: true,
      latest_version: "99.1.0",
      checked_at: new Date().toISOString(),
      behind_commits: [{ hash: "abc1234", subject: XSS[0] }, { hash: "def5678", subject: XSS[1] }],
      doctor: { at: new Date().toISOString(), items: [{ id: "x", level: "warn", title: XSS[2], detail: XSS[0], hint: XSS[1] }] },
      backups: [{ name: "banking-2026-10-09.db.gz", size: 2048, at: new Date().toISOString(), kind: "daily" }],
    }),
  );
  await page.reload();
  await expect(page.getByText(/Apuri toimii/)).toBeVisible();
  // a working helper has its controls on the page
  await expect(page.getByRole("button", { name: "Ota varmuuskopio nyt" })).toBeVisible();
  // a version 1 helper does not know logs, prune and helper-renew: the page says so and offers the command
  await expect(page.getByText(/Apuri ei tue näitä toimintoja/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Lue lokit" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Siivoa levy" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Asenna apuri uudelleen" })).toBeDisabled();
  await expect(page.getByText("Uusi versio 99.1.0 saatavilla")).toBeVisible();
  // shown as text: the tags are on the page as characters, nothing was created from them
  await expect(page.locator(".ops-commits")).toContainText(XSS[0]!);
  await expect(page.locator(".ops-commits")).toContainText(XSS[1]!);
  await expect(page.locator(".ops-doctor")).toContainText(XSS[2]!);
  expect(await page.locator("main script, .ops-commits img, .ops-doctor img").count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // a wrong password is explained in the dialog and queues nothing
  await page.getByRole("button", { name: "Päivitä", exact: true }).click();
  const dialog = page.getByRole("dialog");
  // the dialog names the version it installs
  await expect(dialog.getByText("Päivitetään versioon 99.1.0.")).toBeVisible();
  // the content fits the frame: no scrollbar either way
  expect(await dialog.evaluate((d) => [d.scrollWidth - d.clientWidth, d.scrollHeight - d.clientHeight])).toEqual([0, 0]);
  await dialog.getByLabel("Salasanasi").fill("väärä-salasana-1234");
  await dialog.getByRole("button", { name: "Päivitä" }).click();
  await expect(dialog.getByText("Salasana ei täsmää.")).toBeVisible();
  await dialog.getByLabel("Salasanasi").fill(ADMIN_PASSWORD);
  await dialog.getByRole("button", { name: "Päivitä" }).click();
  await expect(page.getByText(/Jonossa\./)).toBeVisible();
  // one at a time: the other buttons are off while it waits
  await expect(page.getByRole("button", { name: "Ota varmuuskopio nyt" })).toBeDisabled();

  // the helper picks it up and reports a result whose log holds hostile text
  const polled = helper(["poll", "--helper", "2", "--done", ""]);
  expect(polled.request).toMatchObject({ action: "update", params: {}, secret: null });
  // while it runs, the steps the helper tells are on the page at once, a hostile one as text, and the report keeps them
  helper(["progress"], JSON.stringify({ id: polled.request.id, step: { n: 1, m: 2, text: "Varmuuskopio" } }));
  helper(["progress"], JSON.stringify({ id: polled.request.id, step: { n: 2, m: 2, text: `Käynnistys ${XSS[1]}` } }));
  await expect(page.locator(".ops-steps li")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator(".ops-steps")).toContainText(`Käynnistys ${XSS[1]}`);
  await expect(page.locator(".ops-steps li").last()).toContainText(/ \d+ s$/);
  expect(await page.locator(".ops-steps img").count()).toBe(0);
  helper(
    ["report"],
    JSON.stringify({
      id: polled.request.id,
      status: "ok",
      exit_code: 0,
      summary: "Päivitetty versioon 0.4.0",
      output: `STEP: 1/2 Varmuuskopio\nSTEP-AT: 1/2 0\nSTEP: 2/2 Käynnistys ${XSS[1]}\nSTEP-AT: 2/2 3\n${XSS.join("\n")}\nTUNNEL_TOKEN=${"x".repeat(50)}`,
      state: { version: "0.4.0", update_available: false, behind_commits: [], can_rollback: true },
    }),
  );
  await expect(page.getByText("Päivitetty versioon 0.4.0")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Varmuuskopio", { exact: true })).toBeVisible();
  // the report replaced the stored steps with the same two, text unchanged
  await expect(page.locator(".ops-steps li")).toHaveCount(2);
  await expect(page.locator(".ops-steps")).toContainText(`Käynnistys ${XSS[1]}`);
  await page.getByRole("button", { name: "Näytä loki" }).click();
  const log = page.locator(".ops-log");
  await expect(log).toContainText("<script>window.__xss = 1</script>");
  await expect(log).not.toContainText("xxxxxxxxxx");
  expect(await page.locator(".ops-log script, .ops-log img").count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  // rollback is offered now, and asks for the typed word
  await expect(page.getByText(/^Ajan tasalla/)).toBeVisible();
  await page.getByRole("button", { name: "Palauta edellinen versio" }).click();
  await expect(page.getByRole("dialog").getByLabel("Kirjoita PALAUTA vahvistukseksi")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Peruuta" }).click();
  // the audit list shows the request and its end
  await expect(page.getByRole("cell", { name: "päivitys" }).first()).toBeVisible();

  // the helper is version 2 now: logs only read, and the log opens by itself
  await expect(page.getByRole("button", { name: "Lue lokit" })).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByText(/Apuri ei tue näitä toimintoja/)).toHaveCount(0);
  await page.getByRole("button", { name: "Lue lokit" }).click();
  await expect(page.getByText(/Jonossa\./)).toBeVisible();
  const logsReq = helper(["poll", "--helper", "2", "--done", ""]);
  expect(logsReq.request).toMatchObject({ action: "logs", params: {}, secret: null });
  helper(
    ["report"],
    JSON.stringify({
      id: logsReq.request.id,
      status: "ok",
      exit_code: 0,
      summary: "Luettu: banking.",
      output: `STEP: 1/1 Luetaan palvelujen lokit\n== banking ==\nbanking-1  | ${XSS[0]}\nbanking-1  | call with Bearer abc123tokenvalue and eyJhbGciOiJSUzI1NiJ9.eyJ4IjoxfQ.c2ln\nbanking-1  | ordinary line`,
    }),
  );
  await expect(page.getByText("Luettu: banking.")).toBeVisible({ timeout: 15_000 });
  const logsBox = page.locator(".ops-log");
  await expect(logsBox).toContainText("== banking ==");
  await expect(logsBox).toContainText("ordinary line");
  await expect(logsBox).toContainText("<script>window.__xss = 1</script>");
  await expect(logsBox).not.toContainText("abc123tokenvalue");
  await expect(logsBox).not.toContainText("eyJ");
  expect(await page.locator(".ops-log script, .ops-log img").count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // prune and helper-renew: one click each, no dialog, the helper's summary is shown
  ageRequests();
  await page.getByRole("button", { name: "Siivoa levy" }).click();
  await expect(page.getByText(/Jonossa\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Asenna apuri uudelleen" })).toBeDisabled();
  const pruneReq = helper(["poll", "--helper", "2", "--done", ""]);
  expect(pruneReq.request).toMatchObject({ action: "prune", params: {}, secret: null });
  helper(["report"], JSON.stringify({ id: pruneReq.request.id, status: "ok", exit_code: 0, summary: "Levyltä vapautui 1,2 Gt vanhoista versioista ja 300 Mt välimuistista.", output: "STEP: 1/2 Poistetaan vanhat versiot" }));
  await expect(page.getByText("Levyltä vapautui 1,2 Gt vanhoista versioista ja 300 Mt välimuistista.")).toBeVisible({ timeout: 15_000 });
  ageRequests();
  await page.getByRole("button", { name: "Asenna apuri uudelleen" }).click();
  const renewReq = helper(["poll", "--helper", "2", "--done", ""]);
  expect(renewReq.request).toMatchObject({ action: "helper-renew", params: {}, secret: null });
  // a version 2 helper says nothing of the switch for new versions, so the page has none
  const newVersions = page.getByRole("switch", { name: "Tarjoa uudet versiot heti" });
  await expect(newVersions).toHaveCount(0);
  // the renewed helper is version 4, and its first snapshot says where the switch stands on the host
  helper(["state", "--helper", "4"], JSON.stringify({ prerelease: "no", channel: "release" }));
  helper(["report"], JSON.stringify({ id: renewReq.request.id, status: "ok", exit_code: 0, summary: "Apuri asennettu uudelleen." }));
  await expect(page.getByText("Apuri asennettu uudelleen.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("cell", { name: "levyn siivous" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "apurin uusinta" }).first()).toBeVisible();

  // the switch: one click and no dialog, it shows the asked position while the helper works and the host's after it
  await expect(newVersions).toBeEnabled({ timeout: 15_000 });
  await expect(newVersions).not.toBeChecked();
  ageRequests();
  await newVersions.click();
  await expect(page.getByText(/Jonossa\./)).toBeVisible();
  await expect(newVersions).toBeChecked();
  await expect(newVersions).toBeDisabled();
  const switchReq = helper(["poll", "--helper", "4", "--done", ""]);
  expect(switchReq.request).toMatchObject({ action: "prerelease-on", params: {}, secret: null });
  helper(["report"], JSON.stringify({ id: switchReq.request.id, status: "ok", exit_code: 0, summary: "Uudet versiot tarjotaan heti.", state: { prerelease: "yes", channel: "release" } }));
  await expect(page.getByText("Uudet versiot tarjotaan heti.")).toBeVisible({ timeout: 15_000 });
  await expect(newVersions).toBeEnabled();
  await expect(newVersions).toBeChecked();
  await expect(page.getByRole("cell", { name: "uudet versiot tarjolle heti" }).first()).toBeVisible();

  // no horizontal scroll on a phone
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  // the one wrong password is the only refused request
  expect(seen.filter((p) => /status of 403/.test(p))).toHaveLength(1);
  expect(seen.filter((p) => !/status of 403/.test(p))).toEqual([]);
  await context.close();
});

// Palauta uusin varmuuskopio and Tyhjennä kaikki tiedot. A real restore stops the shared e2e server and a real reset
// removes its users, so both POSTs are answered here and never reach it. The copy GET is answered with a made-up copy.
const COPY = { name: "auto-2026-10-09.db", at: "2026-10-09T03:00:00.000Z", size: 3_200_000, kind: "daily" };
const PRE_RESET = { name: "pre-reset-20261009T100000.db", at: "2026-10-09T07:00:00.000Z", size: 3_300_000, kind: "pre-reset" };

test("restore the newest copy and empty everything: the dialogs, the bodies sent, and the page after each answer", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = problems(page);
  page.on("dialog", (d) => {
    seen.push(`unexpected dialog: ${d.message()}`);
    void d.dismiss();
  });
  const restoreCard = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Palauta uusin varmuuskopio" }) });
  const resetCard = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Tyhjennä kaikki tiedot" }) });

  // the earlier test leaves the helper working; the restore card is not drawn without it
  // the real server answers the first read: with a copy or with none, the card has its words either way
  await page.goto("/#/settings?section=maintenance");
  await expect(restoreCard.getByText(/Ehjää varmuuskopiota ei ole\.|Uusin ehjä varmuuskopio/)).toBeVisible();
  await expect(resetCard).toContainText("Poistaa tilit, tapahtumat, lainat, säännöt ja muut käyttäjät.");

  const sent = { restore: [] as unknown[], reset: [] as unknown[] };
  let copy: typeof COPY = COPY;
  let reads = 0;
  const restoreAnswers = [
    { status: 403, json: { error: "Salasana ei täsmää." } },
    { status: 202, json: { copy: COPY } },
  ];
  await page.route("**/api/ops/restore-latest", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      reads++;
      return route.fulfill({ json: { copy, pending: false } });
    }
    sent.restore.push(request.postDataJSON());
    const answer = restoreAnswers.shift()!;
    await route.fulfill({ status: answer.status, json: answer.json });
  });
  const resetAnswers = [
    { status: 409, json: { error: "Toinen toiminto on kesken." } },
    { status: 200, json: { ok: true, copy: "pre-reset-20261009T100000.db", revoked: 1, failed: 2, message: "Tiedot on tyhjennetty. Kirjaudu sisään uudelleen." } },
  ];
  await page.route("**/api/ops/reset", async (route) => {
    sent.reset.push(route.request().postDataJSON());
    const answer = resetAnswers.shift()!;
    // the answer takes a moment, so the button can be seen off while it is awaited
    await new Promise((done) => setTimeout(done, 700));
    // the real answer drops the session cookie
    if (answer.status === 200) await context.clearCookies();
    await route.fulfill({ status: answer.status, json: answer.json });
  });
  await page.reload();

  // the card shows the copy's time large, its file and what is lost; the newest copy was made before this mistake or after it
  await expect(restoreCard.getByText("Uusin ehjä varmuuskopio")).toBeVisible();
  await expect(restoreCard).toContainText(/9\.10\.2026 klo 6\.00/);
  await expect(restoreCard).toContainText("auto-2026-10-09.db");
  await expect(restoreCard).toContainText("Varmuuskopion jälkeen tehdyt muutokset häviävät. Pankkitapahtumat haetaan uudelleen seuraavassa haussa.");
  await expect(restoreCard).not.toContainText("juuri ennen tietojen tyhjennystä");
  expect(reads).toBe(1);

  // a word in the wrong case is stopped by the form: nothing is sent
  await restoreCard.getByRole("button", { name: "Palauta uusin varmuuskopio" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Tietokanta korvataan varmuuskopiolla ajalta")).toBeVisible();
  await dialog.getByLabel("Salasanasi").fill("väärä-salasana-1234");
  await dialog.getByLabel("Kirjoita PALAUTA vahvistukseksi").fill("palauta");
  await dialog.getByRole("button", { name: "Palauta", exact: true }).click();
  expect(sent.restore).toEqual([]);
  // the server's own sentence for a wrong password
  await dialog.getByLabel("Kirjoita PALAUTA vahvistukseksi").fill("PALAUTA");
  await dialog.getByRole("button", { name: "Palauta", exact: true }).click();
  await expect(dialog.getByText("Salasana ei täsmää.")).toBeVisible();
  expect(sent.restore).toEqual([{ password: "väärä-salasana-1234", confirm: "PALAUTA" }]);

  // the 202: the app is asked to stop, and the card waits for /api/health. The first check fails, the next one answers.
  let checks = 0;
  await page.route("**/api/health", (route) => (checks++ === 0 ? route.abort() : route.continue()));
  await dialog.getByLabel("Salasanasi").fill("esimerkki-salasana-123");
  await dialog.getByLabel("Kirjoita PALAUTA vahvistukseksi").fill("PALAUTA");
  await dialog.getByRole("button", { name: "Palauta", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(sent.restore.at(-1)).toEqual({ password: "esimerkki-salasana-123", confirm: "PALAUTA" });
  const asked = page.getByRole("status").filter({ hasText: "Palautus on pyydetty." });
  await expect(asked).toContainText("Sovellus käynnistyy uudelleen ja korvaa tietokannan varmuuskopiolla ajalta");
  await expect(restoreCard.getByRole("button", { name: "Palauta uusin varmuuskopio" })).toHaveCount(0);
  // it never says the restore was done: the notice after the start tells that
  await expect(asked).toContainText("Sivun yläreunan ilmoitus kertoo, tehtiinkö palautus.", { timeout: 20_000 });
  await expect(asked.getByRole("button", { name: "Lataa sivu uudelleen" })).toBeVisible();
  await expect(asked).not.toContainText(/palautettiin|palautettu|onnistui/i);
  expect(sent.restore).toHaveLength(2);
  await expect.poll(() => reads).toBe(2);

  // the copy of a reset is named for what it does
  copy = PRE_RESET;
  await page.reload();
  await expect(restoreCard).toContainText("Tämä varmuuskopio on otettu juuri ennen tietojen tyhjennystä.");
  await expect(restoreCard).toContainText("Sen palautus tuo tyhjennetyt tiedot takaisin.");

  // on a phone: nothing runs sideways
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  // the reset card says before the click what goes, that a copy is taken first and that the banks are connected again
  await resetCard.scrollIntoViewIfNeeded();
  await expect(resetCard).toContainText("Poistaa tilit, tapahtumat, lainat, säännöt ja muut käyttäjät.");
  await expect(resetCard).toContainText("Varmuuskopio otetaan ensin, ja sen voi palauttaa vuorokauden ajan.");
  await expect(resetCard).toContainText("Pankkiyhteydet pitää yhdistää uudelleen.");
  const resetButton = resetCard.locator("button", { hasText: "Tyhjennä kaikki tiedot" });
  await resetButton.click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Salasanasi").fill("esimerkki-salasana-123");
  await dialog.getByLabel("Kirjoita TYHJENNÄ vahvistukseksi").fill("TYHJENNA");
  await dialog.getByRole("button", { name: "Tyhjennä", exact: true }).click();
  expect(sent.reset).toEqual([]);
  // the server's sentence for a refused request, then the request that goes through
  await dialog.getByLabel("Kirjoita TYHJENNÄ vahvistukseksi").fill("TYHJENNÄ");
  await dialog.getByRole("button", { name: "Tyhjennä", exact: true }).click();
  await expect(dialog.getByText("Toinen toiminto on kesken.")).toBeVisible();
  await dialog.getByLabel("Salasanasi").fill("esimerkki-salasana-123");
  await dialog.getByLabel("Kirjoita TYHJENNÄ vahvistukseksi").fill("TYHJENNÄ");
  await dialog.getByRole("button", { name: "Tyhjennä", exact: true }).click();
  // off from the click until the answer
  await expect(dialog.getByRole("button", { name: "Hetki…" })).toBeDisabled();
  await expect(resetButton).toBeDisabled();
  const done = page.getByRole("status").filter({ hasText: "Tiedot on tyhjennetty." });
  await expect(done).toContainText("Tiedot on tyhjennetty. Kirjaudu sisään uudelleen.");
  await expect(done).toContainText("Varmuuskopio ennen tyhjennystä: pre-reset-20261009T100000.db");
  await expect(done).toContainText("2 pankkiyhteyttä jäi voimaan pankissa. Ne vanhenevat itsestään.");
  await expect(done).toContainText("Yhdistä pankit uudelleen, kun olet kirjautunut.");
  await expect(dialog).toBeHidden();
  expect(sent.reset).toEqual([
    { password: "esimerkki-salasana-123", confirm: "TYHJENNÄ" },
    { password: "esimerkki-salasana-123", confirm: "TYHJENNÄ" },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  // the way out is the sign-in page
  await done.getByRole("link", { name: "Kirjaudu sisään" }).click();
  await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();

  // only the answers played above were refused or cut off
  expect(seen.filter((p) => !/status of (403|409)|ERR_FAILED/.test(p))).toEqual([]);
  await context.close();
});
