import { describe, expect, it } from "vitest";
import { unknownPercent } from "../src/components/UnknownShare.tsx";

describe("the share of money not known", () => {
  it("is no percent at 19 % and 20 %", () => {
    expect(unknownPercent(0.19)).toBeNull();
    expect(unknownPercent(0.2)).toBeNull();
  });

  it("rounds to whole percent over the limit", () => {
    expect(unknownPercent(0.2149)).toBe(21);
    expect(unknownPercent(0.2151)).toBe(22);
  });
});
