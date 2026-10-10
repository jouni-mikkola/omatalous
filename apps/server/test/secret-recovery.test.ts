import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { finishInterruptedRotation } from "../src/entry/secret-rotate.ts";
import { resealAll } from "../src/services/secret-rotation.ts";
import { setupApp } from "./helpers.ts";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("a secret rotation that stopped before the rename", () => {
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  async function sealed() {
    const t = await setupApp();
    await t.admin.call("PUT", "/api/bank/credentials", { appId: randomUUID(), privateKeyPem: pem });
    const dir = mkdtempSync(join(tmpdir(), "talous-rot-"));
    dirs.push(dir);
    const file = join(dir, "app_secret");
    writeFileSync(file, `${t.s.config.appSecret}\n`, { mode: 0o600 });
    return { ...t, dir, file, oldSecret: t.s.config.appSecret! };
  }
  const next = "interrupted-new-secret-long-enough-0123456789";

  it("is finished at start when the database is already sealed with the new secret", async () => {
    const t = await sealed();
    writeFileSync(`${t.file}.next`, `${next}\n`, { mode: 0o600 });
    await resealAll(t.s, t.oldSecret, next); // the database commit happened, the rename did not
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await finishInterruptedRotation(t.s, t.file)).toBe(next);
    expect(readFileSync(t.file, "utf8").trim()).toBe(next);
    expect(existsSync(`${t.file}.next`)).toBe(false);
    expect(readdirSync(t.dir).filter((f) => f.startsWith("app_secret.prev-"))).toHaveLength(1);
  });

  it("leaves a .next alone while the database still opens with the current secret", async () => {
    const t = await sealed();
    writeFileSync(`${t.file}.next`, `${next}\n`, { mode: 0o600 });
    expect(await finishInterruptedRotation(t.s, t.file)).toBeNull();
    expect(readFileSync(t.file, "utf8").trim()).toBe(t.oldSecret);
    expect(existsSync(`${t.file}.next`)).toBe(true);
  });

  it("changes nothing when the keys open with neither secret", async () => {
    const t = await sealed();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    writeFileSync(`${t.file}.next`, `${next}\n`, { mode: 0o600 });
    await resealAll(t.s, t.oldSecret, "some-third-secret-long-enough-0123456789");
    expect(await finishInterruptedRotation(t.s, t.file)).toBeNull();
    expect(readFileSync(t.file, "utf8").trim()).toBe(t.oldSecret);
    expect(errors.mock.calls.flat().join(" ")).toMatch(/open with neither/);
  });

  it("does nothing without a .next file", async () => {
    const t = await sealed();
    expect(await finishInterruptedRotation(t.s, t.file)).toBeNull();
  });
});
