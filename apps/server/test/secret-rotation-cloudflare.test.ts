/**
 * A secret rotation with the Cloudflare API token of Asetukset > Palvelin > Etäkäyttö among the sealed values
 * (services/secret-rotation.ts): it is re-sealed under its own context, and when it no longer opens the messages name
 * it and say how to get past it.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { rotateAppSecret } from "../src/entry/secret-rotate.ts";
import { SecretBox } from "../src/security/secretbox.ts";
import { AAD, TOKEN_KEY } from "../src/services/remote-access-cloudflare.ts";
import { databaseOpensWith, resealAll } from "../src/services/secret-rotation.ts";
import { setupApp } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const API_TOKEN = "cfut_0123456789abcdefghijABCDEFGHIJ0123456789";
const NEXT = "the-next-app-secret-0123456789-abcdefghijklmnopq";
const OTHER = "another-copys-secret-0123456789-abcdefghijklmnop";
const SAVED = { savedAt: "2026-10-09T10:00:00.000Z", zones: ["example.fi"] };
const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** An app whose settings hold the API token sealed with `secret` (its own unless told otherwise). */
async function withToken(opts: { bankKey?: boolean; secret?: string } = {}) {
  const t = await setupApp({}, mockBank().fetchMock);
  if (opts.bankKey) expect((await t.admin.call("PUT", "/api/bank/credentials", { appId: randomUUID(), privateKeyPem: pem })).status).toBe(200);
  const box = await SecretBox.fromSecret(opts.secret ?? t.s.config.appSecret!);
  await t.s.settings.set(TOKEN_KEY, JSON.stringify({ keyEnc: await box.seal(API_TOKEN, AAD), ...SAVED }));
  return { ...t, secret: t.s.config.appSecret! };
}

describe("secret rotation and the Cloudflare API token", () => {
  it("re-seals the token under its own context and keeps what was saved with it", async () => {
    const t = await withToken({ bankKey: true });
    expect(await resealAll(t.s, t.secret, NEXT)).toMatchObject({ userKeys: 1 });
    const stored = JSON.parse((await t.s.settings.get(TOKEN_KEY))!);
    const next = await SecretBox.fromSecret(NEXT);
    expect(await next.open(stored.keyEnc, AAD)).toBe(API_TOKEN);
    await expect(next.open(stored.keyEnc, t.adminId)).rejects.toThrow();
    await expect((await SecretBox.fromSecret(t.secret)).open(stored.keyEnc, AAD)).rejects.toThrow();
    expect({ savedAt: stored.savedAt, zones: stored.zones }).toEqual(SAVED);
  });

  it("the token alone decides whether a secret fits the database", async () => {
    const t = await withToken();
    expect(await databaseOpensWith(t.s, t.secret)).toBe(true);
    expect(await databaseOpensWith(t.s, OTHER)).toBe(false);
  });

  it("a token sealed with another secret stops the rotation with a message that names it and the way past it", async () => {
    const t = await withToken({ bankKey: true, secret: OTHER });
    const before = await t.s.settings.get(TOKEN_KEY);
    await expect(resealAll(t.s, t.secret, NEXT)).rejects.toThrow(
      "The Cloudflare API token saved in Asetukset > Palvelin > Etäkäyttö cannot be opened with the current secret. Remove it there and run the rotation again. Nothing was changed.",
    );
    expect(await t.s.settings.get(TOKEN_KEY)).toBe(before);
  });

  it("with the token as the only sealed value, rotate and check name it too", async () => {
    const t = await withToken({ secret: OTHER });
    const dir = mkdtempSync(join(tmpdir(), "talous-rotate-"));
    dirs.push(dir);
    const file = join(dir, "app-secret");
    writeFileSync(file, `${t.secret}\n`, { mode: 0o600 });
    await expect(rotateAppSecret(t.s, { secretFile: file, snapshot: () => "none" })).rejects.toThrow(
      "The Cloudflare API token saved in Asetukset > Palvelin > Etäkäyttö opens with neither the old nor the new secret. Remove it there and run the rotation again. Nothing was changed.",
    );
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m: string) => void lines.push(String(m)));
    expect(await runCli(t.s, ["secret", "check", file])).toBe(4);
    expect(lines).toEqual(["The secret does not open the Cloudflare API token saved in the app."]);
  });
});
