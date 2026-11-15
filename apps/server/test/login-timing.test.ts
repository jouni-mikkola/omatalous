import { describe, expect, it } from "vitest";
import { hashPassword, verifyUniform, type Derivers } from "../src/security/password.ts";

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
  // Derivations are counted, not timed, so a busy machine cannot move the result. Every real name gets a wrong password.
  it("runs the same derivations for a wrong password on an old hash, on a new hash and for an unknown name", async () => {
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

  it("still accepts the right password", async () => {
    const h = await hashPassword("oikea-salasana-123", { memoryKib: 64, passes: 1 });
    expect(await verifyUniform("oikea-salasana-123", h, NEW, { argon2: [{ memoryKib: 64, passes: 1 }], legacyRounds: null })).toBe(true);
  });
});
