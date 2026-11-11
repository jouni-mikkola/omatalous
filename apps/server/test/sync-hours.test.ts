import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/platform/config.ts";

let warn: { mock: { calls: unknown[][] } };
beforeEach(() => void (warn = vi.spyOn(console, "warn").mockImplementation(() => {})));
afterEach(() => void vi.restoreAllMocks());

const hours = (value: string) => loadConfig({ SYNC_HOURS: value }).defaults.syncHours;

describe("SYNC_HOURS", () => {
  it.each([
    ["6,,18", [6, 18]],
    ["6,18,", [6, 18]],
    [" 6 , 18 ", [6, 18]],
    ["0", [0]],
    [",", [6, 18]],
    ["abc", [6, 18]],
  ])("%j gives %j", (value, expected) => {
    expect(hours(value)).toEqual(expected);
  });

  it("keeps four hours of a longer list and warns once", () => {
    expect(hours("4,3,2,1,5")).toEqual([1, 2, 3, 4]);
    const sync = warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("SYNC_HOURS"));
    expect(sync).toHaveLength(1);
    expect(String(sync[0]?.[0])).toContain("4");
  });

  it("does not warn for four or fewer", () => {
    hours("1,2,3,4");
    hours("6,18");
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("SYNC_HOURS"))).toHaveLength(0);
  });
});
