import { describe, expect, it } from "vitest";
import { creditStack } from "../../src/behaviour/credit-stack.ts";
import { HISTORY_MONTHS } from "../kit/household.ts";
import { frame, monthly, withRows } from "./household.ts";

const svea = (from: number) => monthly(from, 0, 15, { cents: -4_600, counterparty: "SVEA BANK AB", description: "LAINAN LYHENNYS 7781234" });
const resurs = (from: number) => monthly(from, 0, 20, { cents: -21_580, counterparty: "RESURS BANK AB", description: "LASKU 5521" });
const klarna = (from: number) => monthly(from, 0, 3, { cents: -3_333, counterparty: "KLARNA BANK AB", description: "OSAMAKSU 99812" });

describe("D5 credit stacking", () => {
  it("tells three consumer credits opened in the last half year beside the card", () => {
    const c = creditStack(withRows([...svea(5), ...resurs(3), ...klarna(2)]).ctx);
    expect(c.opened.value).toBe(3);
    expect(c.active.value).toBe(4);
    expect(c.told).toBe(true);
    expect(c.active.confidence).toBe("estimated");
  });

  it("never calls a line new when its rows start with the history", () => {
    const c = creditStack(withRows([...svea(HISTORY_MONTHS), ...resurs(HISTORY_MONTHS), ...klarna(HISTORY_MONTHS)]).ctx);
    expect(c.active.value).toBe(4);
    expect(c.opened.value).toBe(0);
    expect(c.told).toBe(false);
  });

  it("counts a line opened seven months ago as running, not as new", () => {
    const c = creditStack(withRows([...svea(7), ...resurs(2)]).ctx);
    expect(c.opened.value).toBe(1);
    expect(c.told).toBe(false);
  });

  it("finds no line in one invoice and its refund", () => {
    const { ctx } = withRows([
      { date: frame.on(frame.ago(2), 4), cents: -5_990, counterparty: "KLARNA BANK AB", description: "LASKU 30 PV" },
      { date: frame.on(frame.ago(2), 12), cents: 5_990, counterparty: "KLARNA BANK AB", description: "HYVITYS" },
    ]);
    expect(creditStack(ctx).lines.map((l) => l.kind)).toEqual(["card", "mortgage"]);
  });

  it("finds no line per shop on a checking account typed as a loan", () => {
    const { ctx } = withRows([]);
    const typed = { ...ctx, accounts: ctx.accounts.map((a) => (a.id === "chk" ? { ...a, type: "loan" as const } : a)) };
    const c = creditStack(typed);
    expect(c.lines.filter((l) => l.accountIds.includes("chk"))).toEqual([]);
    expect(c.told).toBe(false);
  });

  it("leaves the mortgage out of the count", () => {
    const c = creditStack(withRows([]).ctx);
    expect(c.lines.find((l) => l.kind === "mortgage")?.active).toBe(true);
    expect(c.active.value).toBe(1);
  });

  it("reads a card's bills before its rows as that card, not a second one", () => {
    const { ctx } = withRows([], { drop: (t) => t.accountId === "card" && t.bookingDate < frame.on(frame.ago(5), 1) });
    const cards = creditStack(ctx).lines.filter((l) => l.kind === "card");
    expect(cards.map((l) => l.key)).toEqual(["account:card"]);
  });

  it("keeps the bills of another issuer that go on after the card's rows begin as a line of their own", () => {
    const { ctx } = withRows(monthly(HISTORY_MONTHS, 0, 22, { cents: -9_000, counterparty: "MORROW BANK ASA", description: "KORTTILASKU" }), {
      drop: (t) => t.accountId === "card" && t.bookingDate < frame.on(frame.ago(5), 1),
    });
    expect(creditStack(ctx).lines.filter((l) => l.kind === "card")).toHaveLength(2);
  });

  describe("credit paying credit", () => {
    const card = monthly(HISTORY_MONTHS, 0, 18, { cents: -15_000, counterparty: "BANK NORWEGIAN ASA", description: "LASKU 66120" });
    const draw = { date: frame.on(frame.ago(1), 3), cents: 200_000, counterparty: "TF BANK AB", description: "LUOTON NOSTO 3341" };

    it("links a draw to a payment beyond another line's usual instalment within 14 days", () => {
      const { ctx, ids } = withRows([...card, draw, { date: frame.on(frame.ago(1), 7), cents: -190_000, counterparty: "BANK NORWEGIAN ASA", description: "LASKU 66120" }]);
      const c = creditStack(ctx);
      expect(c.links.map((l) => l.drawId)).toEqual([ids[card.length]]);
      expect(c.links[0]!.extraCents).toBe(175_000);
      expect(c.told).toBe(true);
    });

    it("does not link a draw spent on a purchase", () => {
      const { ctx } = withRows([...card, draw, { date: frame.on(frame.ago(1), 5), cents: -180_000, counterparty: "AUTOLIIKE ESIMERKKI OY", description: "AUTOKAUPPA ABC-123" }]);
      expect(creditStack(ctx).links).toEqual([]);
    });

    it("does not link the usual instalment that falls after a draw", () => {
      const { ctx } = withRows([...card, { ...draw, date: frame.on(frame.ago(1), 10) }]);
      expect(creditStack(ctx).links).toEqual([]);
    });

    const loan = (agos: number[], cents = -30_000) =>
      agos.map((a) => ({ date: frame.on(frame.ago(a), 18), cents, counterparty: "SVEA BANK AB", description: "LAINAN LYHENNYS 5512" }));
    const second = { date: frame.on(frame.ago(1), 7), cents: -150_000, counterparty: "SVEA BANK AB", description: "LAINAN LYHENNYS 5512" };

    it("does not link a payment to a line with under three payments before the draw", () => {
      const { ctx } = withRows([...loan([2]), draw, second]);
      expect(creditStack(ctx).links).toEqual([]);
    });

    it("links a payment far above the median of three or more earlier payments", () => {
      const { ctx, ids } = withRows([...loan([4, 3, 2]), draw, second]);
      const c = creditStack(ctx);
      expect(c.links.map((l) => l.drawId)).toEqual([ids[3]]);
      expect(c.links[0]!.extraCents).toBe(120_000);
    });

    it("does not link the usual instalment paid on time", () => {
      const { ctx } = withRows([...loan([4, 3, 2]), draw, { ...second, cents: -30_000 }]);
      expect(creditStack(ctx).links).toEqual([]);
    });

    it("does not link a payment 15 days after the draw", () => {
      const { ctx } = withRows([...card, draw, { date: frame.on(frame.ago(1), 18), cents: -190_000, counterparty: "BANK NORWEGIAN ASA", description: "LASKU 66120" }]);
      expect(creditStack(ctx).links).toEqual([]);
    });
  });
});
