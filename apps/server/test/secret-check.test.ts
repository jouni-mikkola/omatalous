/**
 * `secret check <file>`: restore.sh asks whether a secret file opens the restored database before it replaces the
 * app secret. Exit 0 opens (also when no bank key is stored), 4 does not, 1 is a file that could not be tried. The
 * script reads the status, never the sentence. It prints no part of the secret and changes nothing.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { rotateAppSecret } from "../src/entry/secret-rotate.ts";
import { mockBank } from "./mock-bank.ts";
import { setupApp } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const WRONG = "another-copys-secret-0123456789-abcdefghijklmnop";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function secretFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "talous-check-"));
  dirs.push(dir);
  const file = join(dir, "candidate");
  writeFileSync(file, content, { mode: 0o600 });
  return file;
}

/** Runs the command and returns its exit code and everything it printed. */
async function check(s: Parameters<typeof runCli>[0], args: string[]) {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(String(m)));
  vi.spyOn(console, "error").mockImplementation((m: string) => void lines.push(String(m)));
  const code = await runCli(s, ["secret", "check", ...args]);
  vi.restoreAllMocks();
  return { code, out: lines.join("\n") };
}

async function sealedApp() {
  // saving a key tries it against Enable Banking, so the fetch is the mock, never the network
  const t = await setupApp({}, mockBank().fetchMock);
  await t.admin.call("PUT", "/api/bank/credentials", { appId: randomUUID(), privateKeyPem: pem });
  return { ...t, secret: t.s.config.appSecret! };
}

describe("secret check", () => {
  it("exits 0 for the secret that sealed the keys and 4 for another", async () => {
    const t = await sealedApp();
    const before = (await t.s.users.getBankCredentials(t.adminId))!.privateKeyEnc;

    const right = await check(t.s, [secretFile(`${t.secret}\n`)]);
    expect(right.code).toBe(0);
    expect(right.out).toContain("fits");

    const wrong = await check(t.s, [secretFile(`${WRONG}\n`)]);
    expect(wrong.code).toBe(4);
    expect(wrong.out).toContain("does not open");

    // nothing secret is printed and nothing is written
    for (const text of [right.out, wrong.out]) {
      expect(text).not.toContain(t.secret);
      expect(text).not.toContain(WRONG);
      expect(text).not.toContain(t.secret.slice(0, 12));
      expect(text).not.toContain(WRONG.slice(0, 12));
    }
    expect((await t.s.users.getBankCredentials(t.adminId))!.privateKeyEnc).toBe(before);
  });

  it("opens with the shared app key too, not only a member's", async () => {
    const t = await sealedApp();
    await t.admin.call("POST", "/api/admin/bank-app/key", {});
    // the member key is gone, only the shared (pending) key is sealed
    await t.s.db.run("DELETE FROM bank_credentials");
    expect((await check(t.s, [secretFile(t.secret)])).code).toBe(0);
    expect((await check(t.s, [secretFile(WRONG)])).code).toBe(4);
  });

  it("refuses the secret from before a rotation and accepts the new one", async () => {
    const t = await sealedApp();
    const dir = mkdtempSync(join(tmpdir(), "talous-check-"));
    dirs.push(dir);
    const file = join(dir, "app_secret");
    writeFileSync(file, `${t.secret}\n`, { mode: 0o600 });
    await rotateAppSecret(t.s, { secretFile: file, snapshot: () => "snap.db" });
    const next = readFileSync(file, "utf8");
    expect((await check(t.s, [secretFile(t.secret)])).code).toBe(4);
    expect((await check(t.s, [secretFile(next)])).code).toBe(0);
  });

  it("accepts any well-formed secret when no bank key is stored", async () => {
    const { s } = await setupApp();
    expect((await check(s, [secretFile(WRONG)])).code).toBe(0);
  });

  it("exits 1, never 4, with its own sentence for a missing, short or two-line file and for no argument", async () => {
    const { s } = await setupApp();
    const missing = await check(s, [join(tmpdir(), "talous-check-does-not-exist")]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("cannot be read");
    expect((await check(s, [])).out).toContain("cannot be read");
    for (const bad of ["short", `${WRONG}\n${WRONG}\n`, ""]) {
      const r = await check(s, [secretFile(bad)]);
      expect(r.code).toBe(1);
      expect(r.out).toContain("not an app secret");
    }
  });
});
