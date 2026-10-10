import { describe, expect, it } from "vitest";
import { UserError } from "../src/platform/errors.ts";
import { parseBaseUrl, parseBoolean, parseHistoryDays, parseSyncHours, parseTimezone, strictObject } from "../src/platform/validate.ts";

describe("input validators", () => {
  it("parseBaseUrl keeps an http(s) origin and refuses paths, credentials and odd characters", () => {
    expect(parseBaseUrl("https://talous.oma.fi")).toBe("https://talous.oma.fi");
    expect(parseBaseUrl("http://localhost:8080/")).toBe("http://localhost:8080");
    for (const bad of ["https://talous.oma.fi/api", "https://u:p@talous.oma.fi", "ftp://talous.oma.fi", "https://talous.oma.fi?x=1", "https://a b.fi", 5, null]) {
      expect(() => parseBaseUrl(bad), String(bad)).toThrow(UserError);
    }
  });

  it("parseTimezone, parseSyncHours, parseHistoryDays and parseBoolean accept their range only", () => {
    expect(parseTimezone("Europe/Helsinki")).toBe("Europe/Helsinki");
    expect(() => parseTimezone("Mars/Olympus")).toThrow(UserError);
    expect(parseSyncHours([18, 6, 6])).toEqual([6, 18]);
    expect(parseSyncHours([])).toEqual([]);
    expect(() => parseSyncHours([1, 2, 3, 4, 5])).toThrow(UserError);
    expect(() => parseSyncHours([24])).toThrow(UserError);
    expect(parseHistoryDays(30)).toBe(30);
    expect(() => parseHistoryDays(29)).toThrow(UserError);
    expect(() => parseHistoryDays(731)).toThrow(UserError);
    expect(() => parseHistoryDays("100")).toThrow(UserError);
    expect(parseBoolean(false)).toBe(false);
    expect(() => parseBoolean("true")).toThrow(UserError);
  });

  it("strictObject refuses unknown keys and non-objects", () => {
    expect(strictObject({ a: 1 }, ["a", "b"] as const)).toEqual({ a: 1 });
    expect(() => strictObject({ c: 1 }, ["a"] as const)).toThrow("Tuntematon kenttä: c");
    for (const bad of [null, [], "x", 3]) expect(() => strictObject(bad, ["a"] as const)).toThrow(UserError);
  });
});
