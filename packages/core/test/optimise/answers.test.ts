/**
 * Säästövinkit is where the household answers every finding: the insights come along as Muut havainnot (others.ts),
 * a finding covers the insight about its own rows, a dismissed insight waits in Päätetyt until its figure moves 25 %,
 * and a subscription the household answered on Laskut (Lopetettu, or Käytössä after the news) has no finding.
 */
import { describe, expect, it } from "vitest";
import { answeredInsights, type Insight, insightDismissSubject, insightInputOf } from "../../src/analysis/insights/index.ts";
import { allFindings, buildOptimise, coveredBy, type FindingState, type OptimiseInput } from "../../src/optimise/index.ts";
import type { MarkKind, UserMark } from "../../src/types.ts";
import { tx } from "../helpers.ts";
import { FRAME, householdInput, joinHousehold, type PartHousehold } from "./household.ts";
import * as subsPart from "./parts/subscriptions.ts";

const plain = (s: string) => s.replace(/[  ]/g, " ");
const mark = (subject: string, kind: MarkKind, day: string): UserMark => ({ subject, mark: kind, markedAt: `${day}T12:00:00` });
const inputOf = (parts: readonly PartHousehold[], marks: readonly UserMark[] = []) => householdInput(joinHousehold([...parts, { txs: [], inputs: { marks: [...marks], expectedBills: [] } }]));
const kinds = (input: OptimiseInput) => allFindings(buildOptimise(input)).map((f) => f.kind).sort();
const ids = (list: readonly Pick<Insight, "id">[]) => list.map((i) => i.id);
/** Every insight of the running month with its dismissal, before any finding covers one. */
const insightsOf = (input: OptimiseInput) => answeredInsights(insightInputOf(input.ctx, { from: "2026-10-01", to: FRAME.today }, input.inputs!));

/** Viaplay, new in August: three charges of 12,99 €, the overview's "Uusi toistuva maksu". */
const NEW_SERVICE: PartHousehold = {
  txs: ["2026-08-05", "2026-09-05", "2026-10-05"].map((d) => tx({ bookingDate: d, amountCents: -1299, merchant: "Viaplay", description: "VIAPLAY", accountId: "h-chk" })),
};
const NEW_ID = "new:out:h-chk:Viaplay";
const SUBS = subsPart.hit(FRAME);
const ELISA = "price:out:h-chk:Elisa";

describe("Muut havainnot", () => {
  it("brings the running month's insights to the page, outside the headline and the areas", () => {
    const input = inputOf([NEW_SERVICE]);
    const data = buildOptimise(input);
    expect(ids(data.others)).toEqual([NEW_ID]);
    expect(plain(data.others[0]!.title)).toBe("Uusi toistuva maksu: Viaplay 12,99 € kuussa");
    expect(data.othersDismissed).toEqual([]);
    expect(data.headline.count).toBe(0);
    expect(data.checked.findings).toBe(0);
  });

  it("leaves out an insight over half of whose rows are one finding's, shown or decided", () => {
    const input = inputOf([SUBS]);
    expect(ids(insightsOf(input).map((a) => a.insight))).toContain(ELISA);
    const data = buildOptimise(input);
    const rise = allFindings(data).find((f) => f.kind === "rise")!;
    expect(ids(data.others)).not.toContain(ELISA);
    const dismissed: FindingState = { findingId: rise.id, status: "dismissed", reason: "need_it", until: null, effectiveDate: null, midCents: rise.euros!.midCents, baseline: null, decidedAt: "2026-10-01T12:00:00" };
    const after = buildOptimise({ ...input, states: [dismissed] });
    expect(after.dismissed.map((d) => d.finding.id)).toEqual([rise.id]);
    expect(ids(after.others)).not.toContain(ELISA);
  });

  it("counts the payees of every finding together, and leaves out an insight whose untold part is under the gate", () => {
    const rows: Record<string, { payee: string; cents: number }> = {
      a: { payee: "Adobe", cents: -7499 },
      b: { payee: "Adobe", cents: -7499 },
      c: { payee: "Netflix", cents: -1599 },
      d: { payee: "Netflix", cents: -1599 },
      s: { payee: "Spotify", cents: -1199 },
      k: { payee: "K-Market", cents: -40000 },
    };
    const row = (id: string) => rows[id];
    // Adobe's rise is one finding, Netflix is in the video overlap
    const told = new Set(["Adobe", "Netflix", "Max"]);
    // the demo's two rises together, 168 €: every euro of it is a finding's already
    expect(coveredBy({ rows: ["a", "b", "c", "d"], yearlyCents: 16800 }, row, told)).toBe(true);
    // half told, and the rest is 1199 / 8698 of 168 €, about 23 €: under the 120 € gate
    expect(coveredBy({ rows: ["a", "s"], yearlyCents: 16800 }, row, told)).toBe(true);
    // half told, and the rest is 40000 / 47499 of 600 €, about 505 €: the insight has its own to tell
    expect(coveredBy({ rows: ["a", "k"], yearlyCents: 60000 }, row, told)).toBe(false);
    // nothing told: the insight passed its own gate, however small
    expect(coveredBy({ rows: ["s"], yearlyCents: 2000 }, row, told)).toBe(false);
    expect(coveredBy({ rows: ["x"], yearlyCents: 2000 }, row, told)).toBe(false);
    expect(coveredBy({ rows: [], yearlyCents: 2000 }, row, told)).toBe(false);
    expect(coveredBy({ yearlyCents: 2000 }, row, told)).toBe(false);
  });

  it("keeps a dismissed insight in Päätetyt with its mark until its figure moves 25 %", () => {
    const shown = buildOptimise(inputOf([NEW_SERVICE])).others[0]!;
    const subject = insightDismissSubject(shown);
    const data = buildOptimise(inputOf([NEW_SERVICE], [mark(subject, "dismissed", "2026-10-10")]));
    expect(data.others).toEqual([]);
    expect(data.othersDismissed).toEqual([{ insight: shown, subject, markedAt: "2026-10-10T12:00:00" }]);
    // dismissed at a figure the insight has since grown from by 25 %: it returns
    const smaller = `alert:${shown.id}@${Math.round(shown.yearlyCents / 1.25)}`;
    expect(ids(buildOptimise(inputOf([NEW_SERVICE], [mark(smaller, "dismissed", "2026-10-10")])).others)).toEqual([NEW_ID]);
    // and within 25 % it stays away
    const near = `alert:${shown.id}@${Math.round(shown.yearlyCents / 1.2)}`;
    expect(buildOptimise(inputOf([NEW_SERVICE], [mark(near, "dismissed", "2026-10-10")])).othersDismissed.map((d) => d.subject)).toEqual([near]);
  });
});

describe("subscription findings read the household's marks", () => {
  it("shows the rise, the overlap and the renewal without marks", () => {
    expect(kinds(inputOf([SUBS]))).toEqual(["overlap", "renewal", "rise"]);
  });

  it("Lopetettu hides every finding of that service", () => {
    expect(kinds(inputOf([SUBS], [mark("merchant:Elisa", "cancelled", "2026-10-01")]))).toEqual(["overlap", "renewal"]);
    expect(kinds(inputOf([SUBS], [mark("merchant:Tidal", "cancelled", "2026-10-01")]))).toEqual(["renewal", "rise"]);
    expect(kinds(inputOf([SUBS], [mark("merchant:Storytel", "cancelled", "2026-10-01")]))).toEqual(["overlap", "rise"]);
  });

  it("Käytössä hides a rise only when given after the new price, and a renewal when given within a year", () => {
    expect(kinds(inputOf([SUBS], [mark("merchant:Elisa", "in_use", "2026-04-02")]))).toEqual(["overlap", "renewal"]);
    // said in February, before the price rose in March: the rise is news
    expect(kinds(inputOf([SUBS], [mark("merchant:Elisa", "in_use", "2026-02-01")]))).toEqual(["overlap", "renewal", "rise"]);
    expect(kinds(inputOf([SUBS], [mark("merchant:Storytel", "in_use", "2026-01-10")]))).toEqual(["overlap", "rise"]);
    // a year and more ago: the answer has lapsed, as the forgotten-service question's does
    expect(kinds(inputOf([SUBS], [mark("merchant:Storytel", "in_use", "2025-09-01")]))).toEqual(["overlap", "renewal", "rise"]);
  });

  it("Käytössä on every overlapping service answers the overlap; on one of them it does not", () => {
    expect(kinds(inputOf([SUBS], [mark("merchant:Spotify", "in_use", "2026-10-01")]))).toEqual(["overlap", "renewal", "rise"]);
    expect(kinds(inputOf([SUBS], [mark("merchant:Spotify", "in_use", "2026-10-01"), mark("merchant:Tidal", "in_use", "2026-10-01")]))).toEqual(["renewal", "rise"]);
  });

  it("the insights of an answered service go too: a new charge and a price rise", () => {
    expect(ids(insightsOf(inputOf([NEW_SERVICE], [mark("merchant:Viaplay", "in_use", "2026-10-01")])).map((a) => a.insight))).not.toContain(NEW_ID);
    // Käytössä given before the service began did not know of it: a second account's service or a new start
    expect(ids(insightsOf(inputOf([NEW_SERVICE], [mark("merchant:Viaplay", "in_use", "2026-03-01")])).map((a) => a.insight))).toContain(NEW_ID);
    expect(ids(insightsOf(inputOf([NEW_SERVICE], [mark("merchant:Viaplay", "cancelled", "2026-10-01")])).map((a) => a.insight))).not.toContain(NEW_ID);
    expect(ids(insightsOf(inputOf([SUBS], [mark("merchant:Elisa", "in_use", "2026-04-02")])).map((a) => a.insight))).not.toContain(ELISA);
    expect(ids(insightsOf(inputOf([SUBS], [mark("merchant:Elisa", "in_use", "2026-02-01")])).map((a) => a.insight))).toContain(ELISA);
  });
});
