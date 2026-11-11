/**
 * A bill the app found that is no recurring bill: the mark `not-recurring:<series key>` takes it out of the coming
 * list and of the Nyt sum ("Maksut ennen palkkapäivää"), and taking the mark away brings it back. The demo household.
 */
import { seriesMarkSubject } from "@banking/core";
import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

interface Series {
  id: string;
  merchant: string;
  kind: "bill";
  active: boolean;
  typicalAmountCents: number;
}
interface Row {
  name: string;
  cents: number;
  source: string;
}

const subjectOf = (s: Series) => `not-recurring:${seriesMarkSubject(s).slice("series:".length)}`;

describe("a bill marked as not recurring", () => {
  it("leaves the coming list and the Nyt sum, and comes back when the mark is taken away", async () => {
    const { admin } = await setupApp();
    expect((await admin.call("POST", "/api/demo")).status).toBe(200);
    const read = async () => {
      const ahead = (await admin.call("GET", "/api/ahead")).body.ahead as { rows: Row[]; upcoming: Row[]; totals: { dueCents: number; recurringCents: number } };
      const sum = (await admin.call("GET", "/api/dashboard")).body.home.runway.sum as { paymentsCents: number; freeCents: number };
      const series = (await admin.call("GET", "/api/recurring")).body.series as Series[];
      return { ahead, sum, series };
    };
    const before = await read();
    // a found bill that is the only series of its payee and is one payment of the window Nyt counts
    const inWindow = (s: Series) => before.ahead.rows.filter((r) => r.source === "recurring" && r.name === s.merchant);
    const bill = before.series.find((s) => s.kind === "bill" && s.active && before.series.filter((o) => o.merchant === s.merchant).length === 1 && inWindow(s).length === 1);
    expect(bill, "a bill of the demo household in the window").toBeTruthy();
    const cents = -inWindow(bill!)[0]!.cents;
    expect(cents).toBeGreaterThan(0);
    expect(before.sum.paymentsCents).toBe(before.ahead.totals.dueCents);

    const marked = await admin.call("PUT", "/api/marks", { subject: subjectOf(bill!), mark: "dismissed" });
    expect(marked.status).toBe(200);
    expect(marked.body.marks).toMatchObject([{ subject: subjectOf(bill!), mark: "dismissed" }]);

    const after = await read();
    // out of the coming list
    expect(after.ahead.rows.some((r) => r.name === bill!.merchant)).toBe(false);
    expect(after.ahead.upcoming.some((r) => r.name === bill!.merchant)).toBe(false);
    expect(after.ahead.rows.length).toBe(before.ahead.rows.length - 1);
    expect(after.series.some((s) => s.id === bill!.id)).toBe(false);
    expect(after.series.length).toBe(before.series.length - 1);
    // and out of the Nyt sum: the payments shrank by the bill and what is left grew by it
    expect(after.ahead.totals.dueCents).toBe(before.ahead.totals.dueCents - cents);
    expect(after.ahead.totals.recurringCents).toBe(before.ahead.totals.recurringCents - cents);
    expect(after.sum.paymentsCents).toBe(before.sum.paymentsCents - cents);
    expect(after.sum.freeCents).toBe(before.sum.freeCents + cents);
    // the list Laskut reads its typed bills from answers without it too
    expect((await admin.call("GET", "/api/reports?reports=upcoming")).body.upcoming.items.some((i: { merchant: string }) => i.merchant === bill!.merchant)).toBe(false);

    // the mark taken away: the bill is back where it was
    expect((await admin.call("PUT", "/api/marks", { subject: subjectOf(bill!), mark: null })).body.marks).toEqual([]);
    const back = await read();
    expect(back.ahead.rows).toEqual(before.ahead.rows);
    expect(back.sum).toEqual(before.sum);
    expect(back.series.map((s) => s.id)).toEqual(before.series.map((s) => s.id));
  });

  it("is the member's own: another member's list keeps the bill", async () => {
    const app = await setupApp();
    const { admin } = app;
    expect((await admin.call("POST", "/api/demo")).status).toBe(200);
    const member = await app.member("toinen");
    const series = (await admin.call("GET", "/api/recurring")).body.series as Series[];
    const bill = series.find((s) => s.kind === "bill" && s.active)!;
    await member.call("PUT", "/api/marks", { subject: subjectOf(bill), mark: "dismissed" });
    expect(((await admin.call("GET", "/api/recurring")).body.series as Series[]).map((s) => s.id)).toEqual(series.map((s) => s.id));
  });

  it("refuses a subject that names no series and a mark other than dismissed", async () => {
    const { admin } = await setupApp();
    const subject = "not-recurring:out:acc-1:Vattenfall";
    for (const bad of ["not-recurring:", "not-recurring:Vattenfall", "not-recurring:sideways:acc-1:Vattenfall"]) {
      expect((await admin.call("PUT", "/api/marks", { subject: bad, mark: "dismissed" })).status, bad).toBe(400);
    }
    for (const mark of ["in_use", "cancelled"]) expect((await admin.call("PUT", "/api/marks", { subject, mark })).status, mark).toBe(400);
    expect((await admin.call("PUT", "/api/marks", { subject, mark: "dismissed" })).status).toBe(200);
  });
});
