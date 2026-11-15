import { describe, expect, it } from "vitest";
import { toggled } from "../src/components/toggled.ts";

describe("toggled", () => {
  it("opens a closed row and closes an open one, without changing the set it was given", () => {
    const none: ReadonlySet<string> = new Set();
    const one = toggled(none, "food");
    expect([...one]).toEqual(["food"]);
    expect([...none]).toEqual([]);
    expect([...toggled(one, "car")]).toEqual(["food", "car"]);
    expect([...toggled(one, "food")]).toEqual([]);
  });
});
