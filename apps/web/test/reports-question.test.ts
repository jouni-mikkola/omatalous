import type { ConclusionsReport } from "@banking/core";
import { describe, expect, it } from "vitest";
import { questionOf } from "../src/pages/Reports.tsx";

const some = { x: 1 };
const conclusions = (open: string[]) => Object.fromEntries(["kuukausi", "menot", "tulot", "kiinteat", "velat", "saldot", "yhteiset"].map((id) => [id, open.includes(id) ? some : null])) as unknown as ConclusionsReport;

describe("the question Raportit opens", () => {
  const all = conclusions(["kuukausi", "menot", "tulot"]);
  it("a bare address skips the month question, which ignores the period", () => {
    expect(questionOf(all, null, undefined)).toBe("menot");
  });
  it("an asked question opens, month included", () => {
    expect(questionOf(all, "kuukausi", undefined)).toBe("kuukausi");
    expect(questionOf(all, "tulot", undefined)).toBe("tulot");
  });
  it("the month question is the fallback when it is the only one with something to say", () => {
    expect(questionOf(conclusions(["kuukausi"]), null, undefined)).toBe("kuukausi");
  });
});
