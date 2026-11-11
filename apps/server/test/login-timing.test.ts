import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, verifyUniform, type Derivers } from "../src/security/password.ts";

const OLD = { memoryKib: 19_456, passes: 2 };
const NEW = { memoryKib: 32_768, passes: 8 };
const inUse = { argon2: [OLD, NEW], legacyRounds: 1000 };

function counting(): { derive: Derivers; calls: string[] } {
  const calls: string[] = [];
  const derive: Derivers = {
    argon2: async (_p, _s, m, t) => (calls.push(`argon2 ${m}/${t}`), new Uint8Array(32)),
    pbkdf2: async (_p, _s, i) => (calls.push(`pbkdf2 ${i}`), new Uint8Array(32)),
  };
  return { derive, calls };
}

describe("login timing", () => {
  it("runs the same derivations for an old hash, a new hash and an unknown name", async () => {
    const oldHash = await hashPassword("pw-pitka-123456", { memoryKib: 8, passes: 1 }).then((h) => h.replace("m=8,t=1", `m=${OLD.memoryKib},t=${OLD.passes}`));
    const newHash = oldHash.replace(`m=${OLD.memoryKib},t=${OLD.passes}`, `m=${NEW.memoryKib},t=${NEW.passes}`);
    const runs: string[][] = [];
    for (const stored of [oldHash, newHash, null]) {
      const { derive, calls } = counting();
      await verifyUniform("vaara", stored, NEW, inUse, derive);
      runs.push([...calls].sort());
    }
    expect(runs[0]).toEqual(["argon2 19456/2", "argon2 32768/8", "pbkdf2 1000"]);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });

  it("takes about as long for a wrong password of a real name as of an unknown one", async () => {
    const cost = { memoryKib: 4096, passes: 2 };
    const now = { memoryKib: 8192, passes: 4 };
    const real = await hashPassword("oikea-salasana-123", cost);
    const costs = { argon2: [cost, now], legacyRounds: null };
    await verifyPassword("warm-up", real);
    const t = { real: [] as number[], unknown: [] as number[] };
    for (let i = 0; i < 5; i++) {
      for (const [name, stored] of [["real", real], ["unknown", null]] as const) {
        const t0 = performance.now();
        expect(await verifyUniform("vaara-salasana-123", stored, now, costs)).toBe(false);
        t[name].push(performance.now() - t0);
      }
    }
    const fastest = (xs: number[]) => Math.min(...xs);
    expect(Math.abs(fastest(t.unknown) - fastest(t.real)) / fastest(t.real)).toBeLessThan(0.25);
  });

  it("still accepts the right password", async () => {
    const h = await hashPassword("oikea-salasana-123", { memoryKib: 64, passes: 1 });
    expect(await verifyUniform("oikea-salasana-123", h, NEW, { argon2: [{ memoryKib: 64, passes: 1 }], legacyRounds: null })).toBe(true);
  });
});
