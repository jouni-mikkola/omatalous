import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { makeMember, overflow, removeMember } from "./helpers.ts";

// The second sign-in factor on the pages: Asetukset > Kaksivaiheinen kirjautuminen (turn on, recovery codes shown once),
// the code step of the sign-in, a recovery code that works once, and the administrator taking a member's factor away.
// The codes are computed here from the secret the page shows (RFC 6238, SHA-1, 30 seconds, 6 digits).

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
  let bits = "";
  for (const ch of text.replace(/[\s=]/g, "").toUpperCase()) bits += BASE32.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The code of the time step `offset` steps from now (the server accepts one step either side). */
function totp(secret: string, offset = 0, now = Date.now()): string {
  const counter = Math.floor(now / 30_000) + offset;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const at = hmac[hmac.length - 1]! & 0xf;
  const value = (hmac.readUInt32BE(at) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

test("RFC 6238 helper gives the published SHA-1 test codes", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
  expect(totp(secret, 0, 59_000)).toBe("287082");
  expect(totp(secret, 0, 1_111_111_109_000)).toBe("081804");
});

const FETCH = { "X-Requested-With": "fetch" };
const SHOTS = process.env.SHOTS_DIR;

async function signedOut(browser: Browser, width = 1280): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kirjaudu sisään", exact: true })).toBeVisible();
  return { context, page };
}

async function password(page: Page, username: string): Promise<void> {
  await page.getByLabel("Käyttäjätunnus").fill(username);
  await page.getByLabel("Salasana").fill(`${username}-123456`);
  await page.getByRole("button", { name: "Kirjaudu", exact: true }).click();
}

test("a member turns the second factor on, signs in with a code and once with a recovery code, the administrator takes it away", async ({ browser }) => {
  const username = "kaksivaihe";
  const { state, id } = await makeMember(browser, username);
  try {
    const own = await browser.newContext({ storageState: state });
    const page = await own.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/#/settings");
    const card = page.locator(".card", { has: page.getByRole("heading", { name: "Kaksivaiheinen kirjautuminen", exact: true }) });
    await expect(card.getByText("Ei käytössä.", { exact: true })).toBeVisible();

    // turning on: the wrong password and the wrong code are refused with the server's sentences
    await card.getByRole("button", { name: "Ota käyttöön", exact: true }).click();
    await card.getByLabel("Salasana").fill("vaara-salasana-1");
    await card.getByRole("button", { name: "Jatka" }).click();
    await expect(card.getByText("Salasana on väärä.")).toBeVisible();
    await card.getByLabel("Salasana").fill(`${username}-123456`);
    await card.getByRole("button", { name: "Jatka" }).click();
    const secret = ((await card.getByTestId("factor-secret").locator("code").textContent()) ?? "").replace(/\s/g, "");
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    await expect(card.getByRole("link", { name: "Avaa sovelluksessa" })).toHaveAttribute("href", /^otpauth:\/\/totp\//);
    await card.getByLabel("Koodi sovelluksesta").fill(totp(secret, 3));
    await card.getByRole("button", { name: "Ota käyttöön" }).click();
    await expect(card.getByText("Koodi on väärä.")).toBeVisible();
    await card.getByLabel("Koodi sovelluksesta").fill(totp(secret));
    await card.getByRole("button", { name: "Ota käyttöön" }).click();

    // ten recovery codes, shown once with the line that says so
    await expect(card.getByText("Koodit näytetään vain nyt.")).toBeVisible();
    const codes = await card.locator(".recovery-codes code").allTextContents();
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    if (SHOTS) {
      await card.screenshot({ path: join(SHOTS, "factor-on-codes-1280.png") });
      await page.setViewportSize({ width: 390, height: 900 });
      expect(await overflow(page)).toBe(0);
      await card.screenshot({ path: join(SHOTS, "factor-on-codes-390.png") });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await card.getByRole("button", { name: "Valmis" }).click();
    await expect(card.getByText("Käytössä alkaen", { exact: true })).toBeVisible();
    await expect(card.getByText("Palautuskoodeja jäljellä")).toBeVisible();
    await expect(card.locator("dl > div", { hasText: "Palautuskoodeja jäljellä" })).toContainText("10");
    if (SHOTS) {
      await card.screenshot({ path: join(SHOTS, "factor-on-1280.png") });
      await page.setViewportSize({ width: 390, height: 900 });
      await card.screenshot({ path: join(SHOTS, "factor-on-390.png") });
    }
    await own.close();

    // signing in: the password alone does not open the app, a wrong code is refused, a right one (the next step: the
    // server takes one step either side and refuses the step the page used to turn it on) opens it
    {
      const { context, page: login } = await signedOut(browser);
      await password(login, username);
      await expect(login.getByText("Anna koodi 5 minuutin kuluessa.")).toBeVisible();
      const codeField = login.getByLabel("Koodi sovelluksesta");
      await expect(codeField).toHaveAttribute("autocomplete", "one-time-code");
      await expect(codeField).toHaveAttribute("inputmode", "numeric");
      if (SHOTS) {
        await login.locator(".auth-card").screenshot({ path: join(SHOTS, "login-code-1280.png") });
        await login.setViewportSize({ width: 390, height: 800 });
        expect(await overflow(login)).toBe(0);
        await login.locator(".auth-card").screenshot({ path: join(SHOTS, "login-code-390.png") });
      }
      await codeField.fill("000000");
      await login.getByRole("button", { name: "Kirjaudu", exact: true }).click();
      await expect(login.getByText("Koodi on väärä.")).toBeVisible();
      await codeField.fill(totp(secret, 1));
      await login.getByRole("button", { name: "Kirjaudu", exact: true }).click();
      await expect(login.getByRole("heading", { name: "Kirjaudu sisään", exact: true })).toHaveCount(0);
      await context.close();
    }

    // a recovery code opens once; the second time it is refused
    for (const attempt of ["works", "refused"] as const) {
      const { context, page: login } = await signedOut(browser);
      await password(login, username);
      await login.getByRole("button", { name: "Käytä palautuskoodia" }).click();
      await login.getByLabel("Palautuskoodi").fill(codes[0]!.toLowerCase());
      await login.getByRole("button", { name: "Kirjaudu", exact: true }).click();
      if (attempt === "works") await expect(login.getByRole("heading", { name: "Kirjaudu sisään", exact: true })).toHaveCount(0);
      else await expect(login.getByText("Koodi on väärä.")).toBeVisible();
      await context.close();
    }

    // the administrator takes the factor away; the member signs in with the password alone
    const admin = await browser.newContext({ storageState: join(process.env.E2E_DIR ?? ".", "admin-state.json") });
    const adminPage = await admin.newPage();
    await adminPage.goto("/#/settings");
    const row = adminPage.getByRole("row", { name: new RegExp(username) });
    adminPage.once("dialog", (d) => void d.accept());
    await row.getByRole("button", { name: "Poista kaksivaiheinen kirjautuminen" }).click();
    await expect(row.getByRole("button", { name: "Poista kaksivaiheinen kirjautuminen" })).toHaveCount(0);
    await admin.close();
    const again = await browser.newContext();
    const answer = await again.request.post("/api/auth/login", { data: { username, password: `${username}-123456` }, headers: FETCH });
    expect(answer.ok()).toBe(true);
    expect(((await answer.json()) as { needsFactor?: boolean }).needsFactor).toBeUndefined();
    await again.close();
  } finally {
    await removeMember(browser, id);
  }
});
