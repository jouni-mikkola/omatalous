import { expect, type Page, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Asetukset > Palvelin > Ylläpito. The host helper is played by the app's own `ops` CLI on the same data
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

  // reachable from Asetukset
  await page.goto("/#/settings");
  await page.getByRole("link", { name: "Avaa ylläpito" }).click();
  await expect(page.getByRole("heading", { name: "Ylläpito" }).first()).toBeVisible();

  // no helper yet: a clear state, the command to enable it, and no way to queue anything
  await expect(page.getByText("Ylläpitoapuri ei ole käytössä")).toBeVisible();
  await expect(page.getByText("./scripts/install.sh --ops-helper")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ota varmuuskopio nyt" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Tarkista päivitykset" })).toBeDisabled();

  // the helper reports in, with a snapshot full of hostile strings
  helper(
    ["state", "--helper", "1"],
    JSON.stringify({
      version: "0.4.0",
      commit: "abc1234",
      update_available: true,
      checked_at: new Date().toISOString(),
      behind_commits: [{ hash: "abc1234", subject: XSS[0] }, { hash: "def5678", subject: XSS[1] }],
      doctor: { at: new Date().toISOString(), items: [{ id: "x", level: "warn", title: XSS[2], detail: XSS[0], hint: XSS[1] }] },
      backups: [{ name: "banking-2026-10-09.db.gz", size: 2048, at: new Date().toISOString(), kind: "daily" }],
    }),
  );
  await page.reload();
  await expect(page.getByText(/Apuri toimii/)).toBeVisible();
  await expect(page.getByText("Uusi versio saatavilla")).toBeVisible();
  // shown as text: the tags are on the page as characters, nothing was created from them
  await expect(page.locator(".ops-commits")).toContainText(XSS[0]!);
  await expect(page.locator(".ops-commits")).toContainText(XSS[1]!);
  await expect(page.locator(".ops-doctor")).toContainText(XSS[2]!);
  expect(await page.locator("main script, .ops-commits img, .ops-doctor img").count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // a wrong password is explained in the dialog and queues nothing
  await page.getByRole("button", { name: "Päivitä", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Salasanasi").fill("väärä-salasana-1234");
  await dialog.getByRole("button", { name: "Päivitä" }).click();
  await expect(dialog.getByText("Salasana ei täsmää.")).toBeVisible();
  await dialog.getByLabel("Salasanasi").fill(ADMIN_PASSWORD);
  await dialog.getByRole("button", { name: "Päivitä" }).click();
  await expect(page.getByText(/Jonossa\./)).toBeVisible();
  // one at a time: the other buttons are off while it waits
  await expect(page.getByRole("button", { name: "Ota varmuuskopio nyt" })).toBeDisabled();

  // the helper picks it up and reports a result whose log holds hostile text
  const polled = helper(["poll", "--helper", "1", "--done", ""]);
  expect(polled.request).toMatchObject({ action: "update", params: {}, secret: null });
  helper(
    ["report"],
    JSON.stringify({
      id: polled.request.id,
      status: "ok",
      exit_code: 0,
      summary: "Päivitetty versioon 0.4.0",
      output: `STEP: 1/2 Varmuuskopio\nSTEP: 2/2 Käynnistys\n${XSS.join("\n")}\nTUNNEL_TOKEN=${"x".repeat(50)}`,
      state: { version: "0.4.0", update_available: false, behind_commits: [], can_rollback: true },
    }),
  );
  await expect(page.getByText("Päivitetty versioon 0.4.0")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Varmuuskopio", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Näytä loki" }).click();
  const log = page.locator(".ops-log");
  await expect(log).toContainText("<script>window.__xss = 1</script>");
  await expect(log).not.toContainText("xxxxxxxxxx");
  expect(await page.locator(".ops-log script, .ops-log img").count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  // rollback is offered now, and asks for the typed word
  await expect(page.getByText("Ajan tasalla")).toBeVisible();
  await page.getByRole("button", { name: "Palauta edellinen versio" }).click();
  await expect(page.getByRole("dialog").getByLabel("Kirjoita PALAUTA vahvistukseksi")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Peruuta" }).click();
  // the audit list shows the request and its end
  await expect(page.getByRole("cell", { name: "päivitys" }).first()).toBeVisible();

  // no horizontal scroll on a phone
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  // the one wrong password is the only refused request
  expect(seen.filter((p) => /status of 403/.test(p))).toHaveLength(1);
  expect(seen.filter((p) => !/status of 403/.test(p))).toEqual([]);
  await context.close();
});
