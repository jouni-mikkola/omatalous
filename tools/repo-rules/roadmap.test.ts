import { describe, expect, it } from "vitest";
import { shippedAsComing } from "./roadmap.ts";

const page = (coming: string) => `# Roadmap\n\nAfter 0.40.0 the page changed.\n\n## Coming releases\n${coming}\n## Done\n### 0.64.0: shipped\n`;

describe("rule 34 detection", () => {
  it("refuses a heading under Coming releases at or below the released version", () => {
    expect(shippedAsComing(page("### 0.64.0: shipped already\n"), "0.64.0")).toEqual([{ line: 6, why: "lists 0.64.0 as coming, and 0.64.0 is out" }]);
    expect(shippedAsComing(page("### 0.44.0: old\n"), "0.64.0")).toHaveLength(1);
    expect(shippedAsComing(page("### 0.69.0 and 0.64.1: two\n"), "0.64.1")).toHaveLength(1);
    expect(shippedAsComing(page("#### 0.9.9: deeper\n"), "0.64.0")).toHaveLength(1);
  });

  it("accepts the next version and later ones", () => {
    expect(shippedAsComing(page("### 0.65.0: next\n### 0.64.1: a fix\n### 1.0.0: one day\n"), "0.64.0")).toEqual([]);
  });

  it("does not read a version in prose, nor a heading outside the section", () => {
    expect(shippedAsComing(page("Since 0.64.0 shipped, the list moved.\n- 0.20.0 was the start.\n### 0.65.0: next\n"), "0.64.0")).toEqual([]);
    expect(shippedAsComing("## Done\n### 0.44.0: done\n## Version 1.0\n### 0.10.0\n", "0.64.0")).toEqual([]);
  });
});
