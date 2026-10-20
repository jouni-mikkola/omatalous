import { describe, expect, it } from "vitest";
import { UserError } from "../src/platform/errors.ts";
import { isIsoDate, parseBaseUrl, parseBoolean, parseHistoryDays, parseIsoDate, parseOptionalBoolean, parseSyncHours, parseTimezone, strictObject } from "../src/platform/validate.ts";
import { setupApp } from "./helpers.ts";

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
    // an hour out of the day says so; too many hours says how many
    expect(() => parseSyncHours([25])).toThrow("Hakuaika on tasatunti 0–23.");
    expect(() => parseSyncHours([6.5])).toThrow("Hakuaika on tasatunti 0–23.");
    expect(() => parseSyncHours([1, 2, 3, 4, 5])).toThrow("Valitse enintään 4 hakuaikaa.");
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

  it("parseIsoDate takes calendar days only, and parseOptionalBoolean only a boolean", () => {
    expect(parseIsoDate("2024-02-29")).toBe("2024-02-29");
    for (const bad of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-1-01", "2026-01-01T00:00", 20260101, null]) {
      expect(isIsoDate(bad), String(bad)).toBe(false);
      expect(() => parseIsoDate(bad), String(bad)).toThrow(UserError);
    }
    expect(parseOptionalBoolean(undefined)).toBe(false);
    expect(parseOptionalBoolean(true)).toBe(true);
    expect(() => parseOptionalBoolean("false")).toThrow(UserError);
  });
});

describe("request bodies and dates at the routes", () => {
  it("the demo's history is 14 or 26 months, and any other value is the 14", async () => {
    const oldest = async (q: string) => {
      const { admin } = await setupApp();
      expect((await admin.call("POST", `/api/demo${q}`)).status).toBe(200);
      const items: { bookingDate: string }[] = (await admin.call("GET", "/api/transactions?limit=100000&from=2000-01-01&to=2100-01-01")).body.items;
      return items.map((t) => t.bookingDate).sort()[0]!;
    };
    const usual = await oldest("");
    expect(await oldest("?months=99")).toBe(usual);
    expect(await oldest("?months=26") < usual).toBe(true);
  });

  it('createRule: "false" is a 400 and makes no rule; an extra field is a 400 too', async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const txId: string = (await admin.call("GET", "/api/transactions?limit=1")).body.items[0].id;
    expect((await admin.call("PATCH", `/api/transactions/${txId}`, { category: "groceries", createRule: "false" })).status).toBe(400);
    expect((await admin.call("PATCH", `/api/transactions/${txId}`, { category: "groceries", note: "x" })).status).toBe(400);
    expect((await admin.call("GET", "/api/rules")).body.rules).toEqual([]);
    expect((await admin.call("PATCH", `/api/transactions/${txId}`, { category: "groceries", createRule: false })).status).toBe(200);
  });

  it("a category body without category is a 400 and keeps the category set by hand; null clears it", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const txId: string = (await admin.call("GET", "/api/transactions?limit=1")).body.items[0].id;
    expect((await admin.call("PATCH", `/api/transactions/${txId}`, { category: "groceries" })).status).toBe(200);
    const categoryOf = async () => (await admin.call("GET", "/api/transactions?limit=1000&from=2000-01-01&to=2030-01-01")).body.items.find((t: { id: string }) => t.id === txId);
    expect((await admin.call("PATCH", `/api/transactions/${txId}`, {})).status).toBe(400);
    expect((await admin.call("PATCH", `/api/transactions/${txId}`, { createRule: false })).status).toBe(400);
    expect(await categoryOf()).toMatchObject({ category: "groceries", categorySource: "user" });
    expect((await admin.call("PATCH", `/api/transactions/${txId}`, { category: null })).status).toBe(200);
    expect((await categoryOf()).categorySource).not.toBe("user");
  });

  it("the transaction list refuses a date that is not on the calendar", async () => {
    const { admin } = await setupApp();
    expect((await admin.call("GET", "/api/transactions?from=2026-02-30")).status).toBe(400);
    expect((await admin.call("GET", "/api/transactions?to=2026-13-01")).status).toBe(400);
    expect((await admin.call("GET", "/api/transactions?from=2026-02-28&to=2026-03-01")).status).toBe(200);
  });

  it("2026-02-30 is refused by the range and by an expected bill", async () => {
    const { admin } = await setupApp();
    expect((await admin.call("GET", "/api/dashboard?from=2026-02-01&to=2026-02-30")).status).toBe(400);
    expect((await admin.call("GET", "/api/export/transactions.csv?from=2026-02-30&to=2026-03-01")).status).toBe(400);
    expect((await admin.call("POST", "/api/expected-bills", { name: "Vesi", amountCents: 5000, dueDate: "2026-11-31", cadence: "once" })).status).toBe(400);
  });

  it("a missing row is a JSON 404 from the shared error handler", async () => {
    const { admin } = await setupApp();
    for (const [method, path, body] of [
      ["PATCH", "/api/transactions/nope", { category: null }],
      ["PATCH", "/api/accounts/nope", { name: "X" }],
      ["DELETE", "/api/accounts/nope", undefined],
      ["DELETE", "/api/expected-bills/nope", undefined],
    ] as const) {
      const res = await admin.call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.body.error, `${method} ${path}`).toBeTruthy();
    }
  });
});
