import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { removeMade, removeOthers, tempDir } from "./tmp-kit.ts";

describe("tempDir", () => {
  it("a second copy of the module removes what the first made", async () => {
    const dir = tempDir("tmp-kit-copy-");
    // a query makes a second module of the same file; the name is built so that tsc does not look for it
    const second = `${"./tmp-kit.ts"}?copy`;
    const copy = (await import(/* @vite-ignore */ second)) as typeof import("./tmp-kit.ts");
    expect(copy.removeMade).not.toBe(removeMade);
    copy.removeMade();
    expect(existsSync(dir)).toBe(false);
  });

  it("the folders of a file that is done go when another file makes one, its own stay", () => {
    const mine = tempDir("tmp-kit-mine-");
    removeOthers("/another/file.test.ts");
    expect(existsSync(mine)).toBe(false);
    const kept = tempDir("tmp-kit-kept-");
    const next = tempDir("tmp-kit-next-");
    expect(existsSync(kept)).toBe(true);
    removeMade();
    expect(existsSync(kept) || existsSync(next)).toBe(false);
  });
});
