import { describe, expect, it } from "vitest";
import { elsewhereLabel } from "../src/components/bills/outside.ts";

const on = (name: string, digits?: string) => ({ account: { name, ...(digits ? { digits } : {}) } }) as never;
const none = { account: undefined } as never;

describe("elsewhereLabel", () => {
  it("names the one account behind every row, once", () => {
    expect(elsewhereLabel([on("Yhteinen tili", "0381"), on("Yhteinen tili", "0381")])).toBe("Tililtä Yhteinen tili ·· 0381");
  });

  it("names two accounts, and two names then the count of the rest from three", () => {
    expect(elsewhereLabel([on("Yhteinen tili", "0381"), on("Säästö")])).toBe("Tileiltä Yhteinen tili ·· 0381 ja Säästö");
    expect(elsewhereLabel([on("A"), on("B"), on("C"), on("A"), on("D")])).toBe("Tileiltä A, B ja 2 muuta");
  });

  it("names no account when a row has none", () => {
    expect(elsewhereLabel([on("A"), none])).toBe("Muilta tileiltä");
    expect(elsewhereLabel([])).toBe("Muilta tileiltä");
  });
});
