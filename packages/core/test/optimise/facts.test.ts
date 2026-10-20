import { describe, expect, it } from "vitest";
import { addMonths, addMonthsToDate } from "../../src/dates.ts";
import { CPI_FACTS } from "../../src/optimise/facts/cpi.ts";
import { cpiChange, type Fact, FACTS, factFrom, factOn, proposedFrom } from "../../src/optimise/index.ts";

/** Every row: the CPI index points stand apart from `FACTS` so the facts module keeps out of their reader's imports. */
const ROWS: readonly Fact[] = [...FACTS, ...CPI_FACTS];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The expiry rule of the plan: what `Fact.expires` of every row must equal. */
function factExpiry(f: Pick<Fact, "kind" | "asOf" | "validTo" | "verifiedAt">): string {
  switch (f.kind) {
    case "rate":
    case "cpi":
    case "energy":
      return addMonthsToDate(f.asOf, 6);
    case "price_list":
    case "survey":
    case "sample":
      return addMonthsToDate(f.asOf, 12);
    case "law":
      return f.validTo ?? addMonthsToDate(f.verifiedAt, 12);
  }
}

describe("optimise facts", () => {
  it("every row is dated, sourced, verified and expires by the rule", () => {
    const problems: string[] = [];
    for (const f of ROWS) {
      const where = `${f.id} ${f.validFrom}`;
      if (!f.id || !f.label || !f.unit) problems.push(`${where}: id, label and unit are required`);
      if (!Number.isFinite(f.value)) problems.push(`${where}: value is not a number`);
      for (const [name, d] of [["validFrom", f.validFrom], ["asOf", f.asOf], ["verifiedAt", f.verifiedAt], ["expires", f.expires], ["validTo", f.validTo ?? "2000-01-01"]] as const) {
        if (!ISO.test(d)) problems.push(`${where}: ${name} ${d} is not a date`);
      }
      if (!/^https:\/\/[^\s]+\.[a-z]{2,}\//.test(f.source.url) || !f.source.title) problems.push(`${where}: source needs a title and an https address`);
      if (f.expires !== factExpiry(f)) problems.push(`${where}: expires ${f.expires}, the rule gives ${factExpiry(f)}`);
      if (f.verifiedAt < f.asOf && f.kind !== "law") problems.push(`${where}: verified before the date it describes`);
      if (f.period && f.validFrom !== `${f.period}-01`) problems.push(`${where}: a statistic is valid from the first day of its month`);
    }
    expect(problems).toEqual([]);
  });

  it("no two valid rows of one id are in force on the same day", () => {
    const overlaps: string[] = [];
    const valid = ROWS.filter((f) => f.status === "valid");
    for (const a of valid) {
      for (const b of valid) {
        if (a === b || a.id !== b.id) continue;
        const aEnd = a.validTo ?? "9999-12-31";
        const bEnd = b.validTo ?? "9999-12-31";
        if (a.validFrom <= bEnd && b.validFrom <= aEnd) overlaps.push(`${a.id} ${a.validFrom} and ${b.validFrom}`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("CPI covers 24 consecutive months", () => {
    const cpi = FACTS.filter((f) => f.id.startsWith("cpi_yoy:")).map((f) => f.period!);
    expect(cpi).toHaveLength(24);
    cpi.forEach((m, i) => i && expect(m).toBe(addMonths(cpi[i - 1]!, 1)));
    expect(cpiChange("2026-08", "2026-10-15")).toBe(2.2);
    expect(cpiChange("2025-10", "2026-10-15")).toBe(-0.2);
    expect(factOn("cpi_yoy:2026-08", "2026-10-15")?.label).toBe("Inflaatio elokuussa 2026");
    // the series ages as one: six months after its last month nothing is compared
    expect(cpiChange("2026-08", "2027-03-01")).toBeNull();
    expect(cpiChange("2024-09", "2027-03-01")).toBeNull();
    // a month the series does not have
    expect(cpiChange("2026-09", "2026-10-15")).toBeNull();
  });

  const row = (f: Partial<Fact>): Fact => ({
    id: "x",
    label: "X",
    value: 1,
    unit: "%",
    kind: "law",
    status: "valid",
    validFrom: "2026-01-01",
    asOf: "2026-01-01",
    expires: "2027-01-01",
    source: { title: "Lähde", url: "https://example.fi/x" },
    verifiedAt: "2026-01-01",
    ...f,
  });

  it("gives no fact when it is expired, not yet valid, past its end or not valid", () => {
    const today = "2026-10-15";
    expect(factFrom([row({})], "x", today)?.value).toBe(1);
    expect(factFrom([row({ expires: "2026-10-14" })], "x", today)).toBeNull();
    expect(factFrom([row({ validFrom: "2026-10-16" })], "x", today)).toBeNull();
    expect(factFrom([row({ validTo: "2026-10-14" })], "x", today)).toBeNull();
    expect(factFrom([row({ status: "repealed" })], "x", today)).toBeNull();
    expect(factFrom([row({ status: "proposed" })], "x", today)).toBeNull();
    expect(factFrom([row({})], "y", today)).toBeNull();
  });

  it("gives a proposed row only through proposedFrom", () => {
    const rows = [row({ value: 35, expires: "2028-01-01" }), row({ value: 40, status: "proposed", validFrom: "2027-01-01" })];
    expect(factFrom(rows, "x", "2027-02-01")?.value).toBe(35);
    expect(proposedFrom(rows, "x", "2026-10-15")?.value).toBe(40);
    expect(proposedFrom(rows, "x", "2027-01-02")).toBeNull();
  });

  it("applies the expiry rule per kind", () => {
    expect(factExpiry({ kind: "rate", asOf: "2026-08-31", verifiedAt: "2026-10-11" })).toBe("2027-02-28");
    expect(factExpiry({ kind: "cpi", asOf: "2026-08-31", verifiedAt: "2026-10-11" })).toBe("2027-02-28");
    expect(factExpiry({ kind: "energy", asOf: "2026-06-30", verifiedAt: "2026-10-11" })).toBe("2026-12-30");
    expect(factExpiry({ kind: "price_list", asOf: "2026-05-01", verifiedAt: "2026-10-11" })).toBe("2027-05-01");
    expect(factExpiry({ kind: "survey", asOf: "2026-03-15", verifiedAt: "2026-10-11" })).toBe("2027-03-15");
    expect(factExpiry({ kind: "sample", asOf: "2026-08-01", verifiedAt: "2026-10-11" })).toBe("2027-08-01");
    expect(factExpiry({ kind: "law", asOf: "2026-01-01", validTo: "2026-12-31", verifiedAt: "2026-10-11" })).toBe("2026-12-31");
    expect(factExpiry({ kind: "law", asOf: "2026-01-01", verifiedAt: "2026-10-11" })).toBe("2027-10-11");
  });
});
