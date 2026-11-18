/**
 * The daily fetch of the euribor fixings: the report is read by its known shape only (every fixture here is made up),
 * a failure stores nothing, and the fixings stored reach the loans of a request.
 */
import { loansOf } from "@banking/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestInputs } from "../src/services/analysis.ts";
import { fetchReferenceRates } from "../src/services/reference-rates.ts";
import { fetchFixings, parseReport, REFERENCE_RATES_URL } from "../src/providers/reference-rates/client.ts";
import { setupApp } from "./helpers.ts";

afterEach(() => vi.restoreAllMocks());

type Cells = Record<string, string>;
const period = (day: string, cells: Cells) =>
  `<period value="${day}"><matrix1_Title_Collection>${Object.entries(cells)
    .map(([name, value]) => `<rate name="${name}"><intr value="${value}" /></rate>`)
    .join("")}</matrix1_Title_Collection></period>`;
const report = (...periods: string[]) => `﻿<?xml version="1.0" encoding="utf-8"?><Report Name="made-up"><data provider="x"><period_Collection>${periods.join("")}</period_Collection></data></Report>`;
const level = (three: string, six = "2,200", twelve = "2,400"): Cells => ({
  "1 vko (tod.pv/360)": "1,000",
  "3 kk (tod.pv/360)": three,
  "3 kk (tod.pv/365)": "9,999",
  "6 kk (tod.pv/360)": six,
  "12 kk (tod.pv/360)": twelve,
});

describe("parseReport", () => {
  it("reads the three rates by their exact names, in thousandths of a percent, and leaves the rest", () => {
    const rows = parseReport(report(period("2026-01-05", level("2,000")), period("2026-01-06", level("-0,125", "2,2", "2,41"))));
    expect(rows).toEqual([
      { reference: "euribor_3", day: "2026-01-05", rateMilli: 2000 },
      { reference: "euribor_6", day: "2026-01-05", rateMilli: 2200 },
      { reference: "euribor_12", day: "2026-01-05", rateMilli: 2400 },
      { reference: "euribor_3", day: "2026-01-06", rateMilli: -125 },
      { reference: "euribor_6", day: "2026-01-06", rateMilli: 2200 },
      { reference: "euribor_12", day: "2026-01-06", rateMilli: 2410 },
    ]);
  });

  it("skips the empty cell of a day with no fixing, and a day with none at all", () => {
    const rows = parseReport(report(period("2026-01-05", level("")), period("2026-01-06", { "1 vko (tod.pv/360)": "" })));
    expect(rows.map((r) => `${r.reference} ${r.day}`)).toEqual(["euribor_6 2026-01-05", "euribor_12 2026-01-05"]);
  });

  const refused: [string, string][] = [
    ["text that is no report", "<html>maintenance</html>"],
    ["a report with no days", report()],
    ["a day that is cut short", `${report(period("2026-01-05", level("2,000")))}`.replace("</period>", "")],
    ["a day that is no date", report(period("2026-02-30", level("2,000")))],
    ["a day with no date", report(period("x", level("2,000")).replace(' value="x"', ""))],
    ["a rate that is cut short", report(period("2026-01-05", level("2,000")).replace("</rate></matrix1", "</matrix1"))],
    ["a rate with no value cell", report(period("2026-01-05", level("2,000")).replace('<intr value="2,000" />', ""))],
    ["a rate with a decimal point", report(period("2026-01-05", level("2.000")))],
    ["a rate that is text", report(period("2026-01-05", level("n/a")))],
    ["a rate with four decimals", report(period("2026-01-05", level("2,0001")))],
    ["a rate of 25 %", report(period("2026-01-05", level("25,000")))],
    ["a rate of -6 %", report(period("2026-01-05", level("-6,000")))],
    ["a series twice on one day", report(period("2026-01-05", level("2,000")), period("2026-01-05", level("2,100")))],
    ["none of the three rates", report(period("2026-01-05", { "1 vko (tod.pv/360)": "1,000" }))],
  ];
  for (const [label, xml] of refused) it(`refuses ${label}`, () => expect(() => parseReport(xml)).toThrow());
});

describe("fetchFixings", () => {
  const answering = (res: () => Response | Promise<Response>) => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => res());

  it("asks the fixed address for the report, follows no redirect and returns the rows", async () => {
    const fetchMock = answering(() => new Response(report(period("2026-01-05", level("2,000")))));
    const rows = await fetchFixings(fetchMock as unknown as typeof fetch, "today");
    expect(rows).toHaveLength(3);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url).startsWith(`${REFERENCE_RATES_URL}?report=`)).toBe(true);
    expect(String(url)).toContain("euribor_korot_today_xml_fi");
    expect(init?.redirect).toBe("manual");
    const history = answering(() => new Response(report(period("2026-01-05", level("2,000")))));
    await fetchFixings(history as unknown as typeof fetch, "history");
    expect(String(history.mock.calls[0]![0])).toContain("euribor_korot_xml_short_fi");
  });

  it("refuses a redirect, an error status, an answer over 2 MB and a host that is not reached", async () => {
    const fetchWith = (res: () => Response | Promise<Response>) => fetchFixings(answering(res) as unknown as typeof fetch, "today");
    await expect(fetchWith(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }))).rejects.toThrow(/answered 302/);
    await expect(fetchWith(() => new Response("busy", { status: 503 }))).rejects.toThrow(/answered 503/);
    await expect(fetchWith(() => new Response("x".repeat(2_000_001)))).rejects.toThrow(/too large/);
    await expect(fetchWith(() => Promise.reject(new TypeError("fetch failed")))).rejects.toThrow(/not reachable: TypeError/);
  });
});

/** An instance with the fetch on, a clock the test moves and a fake report server. */
async function setup(respond: (url: string) => Response | Promise<Response> = () => new Response(report(period("2026-11-16", level("2,000")), period("2026-11-17", level("2,050"))))) {
  const clock = { now: new Date("2026-11-18T17:00:00Z") }; // 19:00 in Helsinki
  const urls: string[] = [];
  const fetchMock = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return respond(String(url));
  }) as unknown as typeof fetch;
  const t = await setupApp({ REFERENCE_RATES: "true" }, fetchMock, { now: () => clock.now });
  return { ...t, clock, urls };
}

describe("fetchReferenceRates", () => {
  it("asks the report of all the days on an empty table, and stores each rate once", async () => {
    const t = await setup();
    expect(await fetchReferenceRates(t.s)).toEqual({ report: "history", added: 6 });
    expect(t.urls).toHaveLength(1);
    expect(t.urls[0]).toContain("euribor_korot_xml_short_fi");
    expect((await t.s.referenceRates.all()).euribor_6).toEqual([["2026-11-16", 2200], ["2026-11-17", 2200]]);
  });

  it("fetches once a day: not before 18:00 in Helsinki, and not again after a fetch that stored", async () => {
    const t = await setup();
    t.clock.now = new Date("2026-11-18T15:59:00Z"); // 17:59
    expect(await fetchReferenceRates(t.s)).toMatchObject({ skipped: "early" });
    expect(t.urls).toEqual([]);
    t.clock.now = new Date("2026-11-18T16:00:00Z"); // 18:00
    expect(await fetchReferenceRates(t.s)).toMatchObject({ report: "history" });
    expect(await fetchReferenceRates(t.s)).toMatchObject({ skipped: "done" });
    expect(t.urls).toHaveLength(1);
  });

  it("asks the short report the next day, and a day already stored takes the new rate", async () => {
    let three = "2,000";
    const t = await setup(() => new Response(report(period("2026-11-17", level(three)))));
    await fetchReferenceRates(t.s);
    three = "2,100";
    t.clock.now = new Date("2026-11-19T17:00:00Z");
    expect(await fetchReferenceRates(t.s)).toEqual({ report: "today", added: 0 });
    expect(t.urls[1]).toContain("euribor_korot_today_xml_fi");
    expect((await t.s.referenceRates.all()).euribor_3).toEqual([["2026-11-17", 2100]]);
  });

  it("asks the report of all the days again when the newest stored day is over ten days back", async () => {
    const t = await setup();
    await fetchReferenceRates(t.s);
    t.clock.now = new Date("2026-11-27T17:00:00Z"); // 10 days after 2026-11-17
    expect(await fetchReferenceRates(t.s)).toMatchObject({ report: "today" });
    t.clock.now = new Date("2026-11-28T17:00:00Z"); // 11 days
    expect(await fetchReferenceRates(t.s)).toMatchObject({ report: "history" });
  });

  it("does nothing under REFERENCE_RATES=false", async () => {
    const calls = vi.fn();
    const t = await setupApp({ REFERENCE_RATES: "false" }, (async () => (calls(), new Response(""))) as unknown as typeof fetch, { now: () => new Date("2026-11-18T17:00:00Z") });
    expect(await fetchReferenceRates(t.s)).toEqual({ report: null, added: 0, skipped: "off" });
    expect(calls).not.toHaveBeenCalled();
  });

  it("keeps the stored fixings when a report has changed its shape, logs once a day, and tries again at the next tick", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let answer: () => Response = () => new Response(report(period("2026-11-17", level("2,000"))));
    const t = await setup(() => answer());
    await fetchReferenceRates(t.s);
    const stored = await t.s.referenceRates.all();

    t.clock.now = new Date("2026-11-19T17:00:00Z");
    answer = () => new Response(report(period("2026-11-18", level("30,000"))));
    expect(await fetchReferenceRates(t.s)).toMatchObject({ failed: true });
    expect(await fetchReferenceRates(t.s)).toMatchObject({ failed: true });
    expect(t.urls).toHaveLength(3);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toMatch(/^euribor fixings not fetched: report holds a rate outside/);
    expect(await t.s.referenceRates.all()).toEqual(stored);

    t.clock.now = new Date("2026-11-20T17:00:00Z");
    answer = () => new Response("busy", { status: 503 });
    await fetchReferenceRates(t.s);
    expect(error).toHaveBeenCalledTimes(2);

    answer = () => new Response(report(period("2026-11-19", level("2,100"))));
    expect(await fetchReferenceRates(t.s)).toMatchObject({ added: 3 });
    expect(await fetchReferenceRates(t.s)).toMatchObject({ skipped: "done" });
  });
});

describe("the fixings of a request and of GET /api/loans", () => {
  const loan = {
    name: "Asuntolaina",
    kind: "mortgage",
    balanceCents: 15_000_000,
    balanceDate: "2026-09-01",
    rateBp: 300,
    reference: "euribor_12",
    marginBp: 50,
    repayment: "annuity",
    intervalMonths: 1,
    paymentCents: 80_000,
    endDate: "2046-09-15",
    rateReviewDate: "2026-09-01",
  };

  it("reaches a loan as its rate path, and is part of what a change of the fixings changes", async () => {
    const t = await setupApp();
    expect((await t.admin.call("POST", "/api/loans", loan)).status).toBe(200);
    const bare = await requestInputs(t.s, t.adminId, []);
    expect(bare.inputs.fixings).toEqual({});
    expect(loansOf(bare.inputs)[0]).not.toHaveProperty("ratePath");

    await t.s.referenceRates.upsert([
      { reference: "euribor_12", day: "2026-08-31", rateMilli: 2400 },
      { reference: "euribor_12", day: "2026-10-01", rateMilli: 2600 },
    ]);
    const filled = await requestInputs(t.s, t.adminId, []);
    expect(filled.inputs.fixings).toEqual({ euribor_12: [["2026-08-31", 2400], ["2026-10-01", 2600]] });
    expect(loansOf(filled.inputs)[0]).toHaveProperty("ratePath");
    expect(filled.stamp).not.toBe(bare.stamp);
  });

  it("answers the loans with the fixings from the day before the oldest balance, and each member the same public fixings", async () => {
    const t = await setupApp();
    await t.admin.call("POST", "/api/loans", loan);
    await t.s.referenceRates.upsert([
      { reference: "euribor_12", day: "2026-08-20", rateMilli: 2000 },
      { reference: "euribor_12", day: "2026-08-31", rateMilli: 2400 },
      { reference: "euribor_12", day: "2026-09-02", rateMilli: 2500 },
      { reference: "euribor_6", day: "2026-09-02", rateMilli: 2300 },
    ]);
    const body = (await t.admin.call("GET", "/api/loans")).body;
    expect(body.fixings).toEqual({ euribor_12: [["2026-08-31", 2400], ["2026-09-02", 2500]], euribor_6: [["2026-09-02", 2300]] });
    const eero = await t.member("eero");
    // no loan: the newest fixing of each rate alone, which is all a loan saved today would count from
    expect((await eero.call("GET", "/api/loans")).body).toEqual({ loans: [], fixings: { euribor_12: [["2026-09-02", 2500]], euribor_6: [["2026-09-02", 2300]] } });
  });
});
