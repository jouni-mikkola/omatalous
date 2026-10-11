import { describe, expect, it } from "vitest";
import { NOW, setupApp } from "./helpers.ts";

/**
 * The demo history is what the Optimoi page shows in the browser test and to anyone trying the app, so it must give
 * the same two findings, with their euros, on every day. These rows are what `generateDemoData` puts in on purpose:
 * Adobe went from 62,99 to 74,99 once (12 € a month, 144 € a year, seven charges either side) and Netflix and Max are
 * both charged every month (the cheaper one, 11,99 a month, is 143,88 € a year). Netflix's own rise (2 € a month) is
 * under the gate and Disney+ has ended, so neither shows. Any other finding on the demo is a false one or a changed demo.
 */
interface Shown {
  area: string;
  kind: string;
  id: string;
  title: string;
  euros: { lowCents: number; midCents: number; highCents: number };
  certainty: { level: string };
}

async function demoPage(now: Date) {
  const app = await setupApp({}, undefined, { now: () => now });
  expect((await app.admin.call("PUT", "/api/admin/features", { optimise: true })).status).toBe(200);
  await app.admin.call("POST", "/api/demo");
  const { status, body } = await app.admin.call("GET", "/api/optimise");
  expect(status).toBe(200);
  const shown: Shown[] = body.data.areas.flatMap((a: { findings: Shown[] }) => a.findings);
  return { data: body.data, shown, call: app.admin.call };
}

describe("the demo history on the Optimoi page", () => {
  it("gives the Adobe price rise and the two video services, nothing else, with their euros", async () => {
    const { data, shown } = await demoPage(NOW);
    expect(shown.map((f) => [f.area, f.kind, f.euros.lowCents, f.euros.midCents, f.euros.highCents, f.certainty.level])).toEqual([
      ["subscriptions", "rise", 14_400, 14_400, 14_400, "korkea"],
      ["subscriptions", "overlap", 14_388, 14_388, 14_388, "keskitaso"],
    ]);
    expect(shown[0]!.id).toMatch(/^subscriptions:rise:.*:Adobe$/);
    expect(shown[0]!.title).toBe("Adobe: hinta nousi 62,99 € → 74,99 € 14.4.2026. Nousu on 144 € vuodessa.");
    expect(shown[1]!.id).toBe("subscriptions:overlap:video");
    expect(shown[1]!.title).toBe("Kaksi videopalvelua yhteensä 29,98 € kuussa: Netflix ja Max.");
    // the two findings share no series, so the headline is their sum
    expect(data.headline).toEqual({ lowCents: 28_788, midCents: 28_788, highCents: 28_788, count: 2 });
    expect(data.checked.findings).toBe(2);
    expect(data.soon).toEqual([]);
    expect(data.months).toBe(12);
    // the other twelve areas are quiet: each says it looked, none has a finding
    expect(data.areas.filter((a: { findings: unknown[] }) => a.findings.length === 0)).toHaveLength(12);
  });

  it("gives the same two findings on days at the start, the middle and the end of a month, and across the year", async () => {
    for (const day of ["2026-08-01", "2026-10-31", "2026-12-24", "2027-02-28", "2027-04-15", "2027-07-01"]) {
      const { shown } = await demoPage(new Date(`${day}T10:00:00Z`));
      expect(shown.map((f) => [f.kind, f.euros.midCents]), day).toEqual([
        ["rise", 14_400],
        ["overlap", 14_388],
      ]);
    }
  });

  it("lets the household decide on both findings and keeps the decision", async () => {
    const { shown, call } = await demoPage(NOW);
    const enc = encodeURIComponent;
    const evidence = await call("GET", `/api/optimise/evidence?id=${enc(shown[1]!.id)}`);
    expect(evidence.status).toBe(200);
    expect(evidence.body.rows.length).toBeGreaterThan(20);
    const dismissed = await call("PUT", `/api/optimise/findings/${enc(shown[0]!.id)}`, { status: "dismissed", reason: "need_it" });
    expect(dismissed.status).toBe(200);
    const after = await call("GET", "/api/optimise");
    expect(after.body.data.dismissed.map((d: { finding: Shown }) => d.finding.kind)).toEqual(["rise"]);
    expect(after.body.data.areas.flatMap((a: { findings: Shown[] }) => a.findings).map((f: Shown) => f.kind)).toEqual(["overlap"]);
    // a dismissed finding leaves the headline too
    expect(after.body.data.headline.midCents).toBe(14_388);
  });
});
