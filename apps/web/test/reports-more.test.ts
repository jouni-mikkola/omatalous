import type { QuestionId } from "@banking/core";
import { describe, expect, it } from "vitest";
import { questionOf } from "../src/pages/reports/More.tsx";

describe("the question Raportit opens", () => {
  const all: QuestionId[] = ["kuukausi", "menot", "tulot"];
  it("a bare address skips the month question, which ignores the period", () => {
    expect(questionOf(all, null, undefined)).toBe("menot");
  });
  it("an asked question opens, month included", () => {
    expect(questionOf(all, "kuukausi", undefined)).toBe("kuukausi");
    expect(questionOf(all, "tulot", undefined)).toBe("tulot");
  });
  it("the month question is the fallback when it is the only one with something to show", () => {
    expect(questionOf(["kuukausi"], null, undefined)).toBe("kuukausi");
  });
  it("a question that has gone falls back to the first open one", () => {
    expect(questionOf(all, "kiinteat", undefined)).toBe("menot");
  });
});
