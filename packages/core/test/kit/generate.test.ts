/**
 * The generator of households (generate.ts) is checked against itself: its labels add up, its balances prove through
 * `reconcile`, and it makes the same household for the same seed, for one member to four. The invariants of the
 * engine are judged over these households in invariants.generated.test.ts, so a fault here would read as a fault there.
 */
import { describe, expect, it } from "vitest";
import { viewsOf } from "../../../../tools/findings/households.ts";
import { partCents } from "../../src/account-use.ts";
import { generatedSet, generateHousehold, proveAccount } from "./generate.ts";
import { centsByFlow, type EventId, labelProblems, type Spec } from "./truth.ts";

const LONG = 30_000;
const EVENTS: EventId[] = ["benefit-rule", "payment-app", "namesake", "member-fee", "refund"];

describe("generated households", () => {
  it(
    "give every row exactly one label, and the labels add up",
    () => {
      for (const h of generatedSet()) expect(labelProblems(h), h.name).toEqual([]);
    },
    LONG,
  );

  it(
    "split each cent into one flow: the flows and the loan mirrors cover every row",
    () => {
      for (const h of generatedSet()) {
        const flows = centsByFlow(h.txs, h.truth);
        const all = h.txs.reduce((s, t) => s + t.amountCents, 0);
        expect(flows.income + flows.consumption + flows.debt + flows.borrowed + flows.transfer + flows.mirror, h.name).toBe(all);
        const instalments = [...h.truth.entries()].filter(([, l]) => l.kind === "loan_instalment").reduce((s, [id]) => s + h.txs.find((t) => t.id === id)!.amountCents, 0);
        expect(flows.mirror, h.name).toBe(0 - instalments);
      }
    },
    LONG,
  );

  it(
    "prove every balance through reconcile, to the cent",
    () => {
      for (const h of generatedSet()) {
        for (const a of h.accounts.filter((x) => x.type !== "loan")) expect(proveAccount(h, a.id)?.status, `${h.name} ${a.id}`).toBe("proved");
      }
    },
    LONG,
  );

  it(
    "do not prove when the bank gives no reference day",
    () => {
      const h = generateHousehold({ members: 2, reference: false }, 1);
      expect(proveAccount(h, h.accounts[0]!.id)?.status).toBe("unknown");
    },
    LONG,
  );

  it("make the balance the opening plus the rows", () => {
    const h = generateHousehold({ members: 3, joint: "said", loan: "savings", cards: "connected" }, 7);
    for (const b of h.balances.filter((x) => x.balanceCents !== null)) {
      expect(b.balanceCents, b.id).toBe(h.openings.get(b.id)! + h.txs.filter((t) => t.accountId === b.id).reduce((s, t) => s + t.amountCents, 0));
    }
  });

  for (const members of [1, 2, 3, 4] as const) {
    it(
      `make a household of ${members} member${members > 1 ? "s" : ""} with views for each`,
      () => {
        const h = generateHousehold({ members, joint: "unknown", loan: "savings", cards: "connected", events: EVENTS }, 3);
        expect(h.members).toHaveLength(members);
        const owned = h.members.flatMap((m) => m.accountIds);
        expect(new Set(owned).size).toBe(owned.length);
        // every account is one member's or shared
        for (const a of h.accounts) expect(owned.includes(a.id) || h.shared.some((s) => s.accountId === a.id), a.id).toBe(true);
        const views = viewsOf(h);
        expect(views.map((v) => v.member)).toEqual([null, ...h.members.map((m) => m.id)]);
        // a member's rows are all in the household's, and a joint account is in every member's view
        const household = new Set(views[0]!.txs.map((t) => t.id));
        for (const v of views.slice(1)) for (const t of v.txs) expect(household.has(t.id), `${v.member} ${t.id}`).toBe(true);
        for (const v of views.slice(1)) expect(v.accounts.some((a) => a.id === "joint")).toBe(true);
      },
      LONG,
    );
  }

  it("count a balance in the own view at the member's part, so the parts of a joint account add up to the bank's balance", () => {
    for (const members of [2, 3, 4] as const) {
      const h = generateHousehold({ members, joint: "said", cards: "connected" }, 11);
      const views = viewsOf(h);
      const whole = h.balances.find((b) => b.id === "joint")!.balanceCents!;
      const parts = views.slice(1).map((v) => ({ b: v.balances.find((b) => b.id === "joint")!, part: v.parts.get("joint")! }));
      for (const { b, part } of parts) expect(b.balanceCents, `${members} members`).toBe(partCents(whole, part));
      expect(parts.reduce((s, p) => s + p.b.balanceCents!, 0), `${members} members`).toBe(whole);
      // the weights are uneven, so a part is no round share of the whole
      expect(new Set(parts.map((p) => p.b.balanceCents)).size).toBeGreaterThan(1);
      // an account only one member holds is that member's whole balance, and the household view keeps every balance whole
      for (const a of h.accounts.filter((x) => x.id !== "joint" && x.type !== "loan")) {
        const owner = views.slice(1).filter((v) => v.balances.some((b) => b.id === a.id));
        expect(owner, a.id).toHaveLength(1);
        expect(owner[0]!.balances.find((b) => b.id === a.id)!.balanceCents, a.id).toBe(h.balances.find((b) => b.id === a.id)!.balanceCents);
      }
      expect(views[0]!.balances.find((b) => b.id === "joint")!.balanceCents).toBe(whole);
    }
  });

  it("make the same household for the same seed and another for another", () => {
    const spec: Spec = { members: 2, cards: "connected" };
    const rows = (seed: number) => generateHousehold(spec, seed).txs.map((t) => [t.id, t.amountCents]);
    expect(rows(5)).toEqual(rows(5));
    expect(rows(5)).not.toEqual(rows(6));
  });

  it("make rows for each event, and label them with it", () => {
    for (const event of EVENTS) {
      const h = generateHousehold({ members: 2, events: [event] }, 2);
      expect([...h.truth.values()].filter((l) => l.event === event).length, event).toBeGreaterThan(0);
    }
  });
});
