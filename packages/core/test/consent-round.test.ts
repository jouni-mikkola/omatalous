import { describe, expect, it } from "vitest";
import { dueConsents, type RoundConnection, roundView, WARN_DAYS } from "../src/consent-round.ts";

const bankOf = (name: string) => ({ Nordea: "nordea-fi", OP: "op-fi", "S-Pankki": "s-pankki-fi", Outo: null })[name] ?? null;
const all = new Set(["nordea-fi", "op-fi", "s-pankki-fi"]);
const consent = (id: string, institution: string, extra: Partial<RoundConnection> = {}): RoundConnection => ({
  id,
  institution,
  state: "active",
  history: false,
  replaced: false,
  daysLeft: 90,
  ...extra,
});

describe("dueConsents", () => {
  it("lists ended consents first, then the soonest to end, and leaves out what is not due", () => {
    const due = dueConsents(
      [consent("n", "Nordea", { daysLeft: WARN_DAYS }), consent("s", "S-Pankki", { daysLeft: WARN_DAYS + 1 }), consent("o", "OP", { state: "lapsed", daysLeft: null })],
      bankOf,
      all,
    );
    expect(due).toEqual([{ connection: "o", bank: "op-fi" }, { connection: "n", bank: "nordea-fi" }]);
  });

  it("lists every consent of a bank, since each has its own accounts", () => {
    const due = dueConsents([consent("n1", "Nordea", { daysLeft: 9 }), consent("o", "OP", { daysLeft: 3 }), consent("n2", "Nordea", { state: "broken", daysLeft: null })], bankOf, all);
    expect(due).toEqual([{ connection: "n2", bank: "nordea-fi" }, { connection: "o", bank: "op-fi" }, { connection: "n1", bank: "nordea-fi" }]);
  });

  it("skips history, a consent a newer one replaced, one the user removed, a bank outside the registry and a bank that cannot be started", () => {
    const due = dueConsents(
      [
        consent("a", "Nordea", { state: "lapsed", daysLeft: null, history: true }),
        consent("b", "OP", { state: "broken", daysLeft: null, replaced: true }),
        consent("c", "S-Pankki", { state: "removed", daysLeft: null }),
        consent("d", "Outo", { state: "lapsed", daysLeft: null }),
      ],
      bankOf,
      all,
    );
    expect(due).toEqual([]);
    expect(dueConsents([consent("e", "OP", { daysLeft: 2 })], bankOf, new Set(["nordea-fi"]))).toEqual([]);
  });
});

describe("roundView", () => {
  const round = { startedAt: "2026-10-09T10:00:00.000Z", consents: [{ connection: "o", bank: "op-fi" }, { connection: "n1", bank: "nordea-fi" }, { connection: "n2", bank: "nordea-fi" }] };
  const open = [consent("o", "OP", { state: "lapsed", daysLeft: null }), consent("n1", "Nordea", { daysLeft: 5 }), consent("n2", "Nordea", { daysLeft: 4 })];

  it("leaves a consent open while it is still due, and closes it once a newer consent took its accounts", () => {
    expect(roundView(round, open).consents.map((c) => c.done)).toEqual([false, false, false]);
    const view = roundView(round, [consent("o", "OP", { state: "lapsed", daysLeft: null, replaced: true }), consent("n1", "Nordea", { daysLeft: null, history: true }), open[2]!]);
    expect(view.consents.map((c) => c.done)).toEqual([true, true, false]);
    expect(view.finished).toBe(false);
  });

  it("is finished only when every consent of a bank is done, not when one of them is", () => {
    const renewed = [consent("o", "OP", { history: true }), consent("n1", "Nordea", { history: true }), consent("n2", "Nordea", { history: true })];
    expect(roundView(round, renewed).finished).toBe(true);
    expect(roundView(round, [renewed[0]!, renewed[1]!, open[2]!]).finished).toBe(false);
  });

  it("counts a consent that is gone as done", () => {
    expect(roundView(round, open.slice(0, 2)).consents.map((c) => c.done)).toEqual([false, false, true]);
  });
});
