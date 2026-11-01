import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, verifyUniform } from "../src/security/password.ts";
import { toBase64Url, utf8 } from "../src/security/encoding.ts";

const COST = { memoryKib: 19_456, passes: 2 };

/** A hash as the versions before Argon2id wrote it. */
async function legacyHash(password: string, iterations = 1000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", utf8.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return `pbkdf2_sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

describe("Argon2id timing", () => {
  it("an unknown name takes within 20 % of a real check, also while an old hash is left", async () => {
    const real = await hashPassword("pitka-salasana-123", COST);
    const old = await legacyHash("vanha-salasana-123", 600_000);
    await verifyPassword("warm-up", real);
    const times = { real: [] as number[], unknown: [] as number[], old: [] as number[] };
    const mixed = { real: [] as number[], unknown: [] as number[], old: [] as number[] };
    // interleaved, so a slow moment of the machine hits all alike
    for (let i = 0; i < 5; i++) {
      for (const [name, stored] of [["real", real], ["unknown", null], ["old", old]] as const) {
        let t0 = performance.now();
        await verifyUniform("vaara-salasana-123", stored, COST, null);
        if (name !== "old") times[name].push(performance.now() - t0);
        t0 = performance.now();
        await verifyUniform("vaara-salasana-123", stored, COST, 600_000);
        mixed[name].push(performance.now() - t0);
      }
    }
    // the fastest run of each: a busy machine only adds time, so the minimum is the cost of the hash itself
    const fastest = (xs: number[]) => Math.min(...xs);
    expect(Math.abs(fastest(times.unknown) - fastest(times.real)) / fastest(times.real)).toBeLessThan(0.2);
    expect(Math.abs(fastest(mixed.unknown) - fastest(mixed.real)) / fastest(mixed.real)).toBeLessThan(0.2);
    expect(Math.abs(fastest(mixed.old) - fastest(mixed.real)) / fastest(mixed.real)).toBeLessThan(0.2);
  });
});
