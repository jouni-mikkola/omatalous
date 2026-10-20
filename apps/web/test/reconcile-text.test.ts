import type { ReconcileResult } from "@banking/core";
import { describe, expect, it } from "vitest";
import { periodText, reconcileView } from "../src/pages/settings/reconcile-text.ts";

type Interval = ReconcileResult["intervals"][number];
const interval = (fromDay: string, toDay: string, over: Partial<Interval> = {}): Interval => ({
  fromDay, toDay, deltaCents: 0, sumCents: 0, diffCents: 0, state: "matched", mark: null, reason: null, hint: null, ...over,
});
const result = (over: Partial<ReconcileResult>): ReconcileResult => ({
  type: "CLBD", sign: 1, status: "proved", reason: null, provedFrom: null, provedTo: null, lastMatchedTo: null, intervals: [], ...over,
});

describe("the words of Täsmää pankin saldoon", () => {
  it("gives each reason id its bank phrase and no tick", () => {
    const text = (reason: ReconcileResult["reason"]) => reconcileView(result({ status: "unknown", type: null, reason })).reason;
    expect(text("only_available")).toBe("vain käytettävissä oleva saldo");
    expect(text("no_reference_day")).toBe("ei viitepäivää");
    expect(text("type_changed")).toBe("tyyppi vaihtui");
    expect(text("too_few")).toBe("liian vähän saldoja");
    expect(reconcileView(result({ status: "unknown", reason: "too_few" })).proved).toBe(false);
  });

  it("says a check that cannot be made yet is not a mismatch", () => {
    const line = (reason: ReconcileResult["reason"]) => reconcileView(result({ status: "unknown", type: null, reason })).headline;
    expect(line("too_few")).toBe("Saldoa ei voi vielä verrata pankkiin: saldotietoja on liian vähän");
    expect(line("only_available")).toBe("Saldoa ei voi vielä verrata pankkiin: pankki kertoo vain käytettävissä olevan saldon");
    expect(line("type_changed")).toBe("Saldoa ei voi vielä verrata pankkiin: saldon tyyppi vaihtui");
    expect(reconcileView(result({ status: "differs" })).headline).toBe("Ei täsmää pankin saldoon");
    expect(reconcileView(result({})).headline).toBe("Täsmää pankin saldoon");
  });

  it("ticks a proved stretch and lists it with its days", () => {
    const v = reconcileView(result({ provedFrom: "2026-10-01", provedTo: "2026-10-07", intervals: [interval("2026-10-01", "2026-10-07")] }));
    expect(v.proved).toBe(true);
    expect(v.reason).toBeNull();
    expect(v.rows).toEqual([{ from: "2026-10-01", to: "2026-10-07", days: "7 päivää", text: "täsmää", stop: false }]);
    expect(periodText(v.rows[0]!)).toBe("1.10.2026–7.10.2026");
  });

  it("folds neighbours that match into one stretch and says where the walk stopped, with a signed difference", () => {
    const v = reconcileView(
      result({
        status: "differs",
        provedFrom: null,
        intervals: [
          interval("2026-09-01", "2026-09-10"),
          interval("2026-09-11", "2026-09-30", { state: "differs", diffCents: 1 }),
          interval("2026-10-01", "2026-10-02"),
          interval("2026-10-03", "2026-10-03"),
          interval("2026-10-04", "2026-10-07", { state: "differs", diffCents: -123456 }),
        ],
      }),
    );
    expect(v.reason).toBe("ei täsmää");
    expect(v.rows.map((r) => [r.from, r.to, r.days, r.text, r.stop])).toEqual([
      ["2026-10-04", "2026-10-07", "4 päivää", "ero −1 234,56 €", true],
      ["2026-10-01", "2026-10-03", "3 päivää", "täsmää", false],
      ["2026-09-11", "2026-09-30", "20 päivää", "ero 0,01 €", false],
      ["2026-09-01", "2026-09-10", "10 päivää", "täsmää", false],
    ]);
  });

  it("names the reason of an interval that is unknown and the type change after a proved series", () => {
    const v = reconcileView(
      result({
        status: "unknown",
        reason: null,
        intervals: [interval("2026-10-01", "2026-10-02", { state: "unknown", reason: "rows_start_later" }), interval("2026-10-03", "2026-10-04", { state: "unknown", reason: "foreign_rows" })],
      }),
    );
    expect(v.reason).toBe("osa tapahtumista on muussa valuutassa");
    expect(v.rows.map((r) => r.text)).toEqual(["osa tapahtumista on muussa valuutassa", "tapahtumat alkavat myöhemmin"]);
    const t = reconcileView(result({ reason: "type_changed", intervals: [interval("2026-10-01", "2026-10-02")] }));
    expect(t.proved).toBe(true);
    expect(t.after).toBe("tyyppi vaihtui");
  });

  it("has nothing to open when there are no intervals", () => {
    expect(reconcileView(result({ status: "unknown", type: null, reason: "too_few" })).rows).toEqual([]);
  });
});
