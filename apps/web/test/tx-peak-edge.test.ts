/** The sum above the highest bar of Tapahtumat stays inside the plot when the bar is at an edge. */
import { describe, expect, it } from "vitest";
import { peakEdge } from "../src/pages/transactions/TotalsStrip.tsx";

describe("the sum of the highest bar", () => {
  it("is tied to the edge when its bar is among the first or the last", () => {
    expect(peakEdge(0, 30)).toBe("start");
    expect(peakEdge(29, 30)).toBe("end");
    expect(peakEdge(1, 12)).toBe("start");
  });

  it("is centred on its bar elsewhere", () => {
    expect(peakEdge(15, 30)).toBeUndefined();
    expect(peakEdge(5, 30)).toBeUndefined();
    expect(peakEdge(0, 3)).toBeUndefined();
    expect(peakEdge(0, 1)).toBeUndefined();
  });
});
