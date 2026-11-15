/** The time of joining the copies of a pool: 5 000 rows through a map, not a scan. It runs in the perf project (docs/DEVELOPMENT.md). */
import { describe, expect, it } from "vitest";
import { joinCopies } from "../src/money-trace-rows.ts";
import { bestOfSync } from "../../../tools/lib/timing.ts";
import { pair5000 } from "./money-trace-rows-kit.ts";

describe("joinCopies", () => {
  it("joins 5 000 rows through a map, not a scan", () => {
    const { ms, result: j } = bestOfSync(3, () => joinCopies([{ accountId: "pool-a", rows: pair5000.a }, { accountId: "pool-b", rows: pair5000.b }]));
    expect(j.rows).toHaveLength(5000);
    expect(ms).toBeLessThan(3000);
  });
});
