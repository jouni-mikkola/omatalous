/** The time of the chart kit: 2 000 points scaled, decimated and drawn inside the time of a frame (16 ms). It runs in the perf project (docs/DEVELOPMENT.md). */
import { describe, expect, it } from "vitest";
import { linear, points } from "../src/charts/kit/scale.ts";
import { linePath } from "../src/charts/kit/path.ts";
import { decimate } from "../src/charts/kit/decimate.ts";
import { bestOfSync } from "../../../tools/lib/timing.ts";

describe("a long series", () => {
  const values = Array.from({ length: 2000 }, (_, i) => Math.round(Math.sin(i / 30) * 10_000) + (i === 777 ? 90_000 : 0));

  it("scales, decimates and draws 2 000 points inside a frame (16 ms)", () => {
    const run = () => {
      const s = linear(values, [240, 0]);
      const at = points(values.length, 800);
      return linePath(values, at, s, decimate(values, 800));
    };
    // the time: the process's CPU time, the best of five runs after a warm-up (`bestOfSync`)
    expect(bestOfSync(5, run).ms).toBeLessThan(16);
  });
});
