/**
 * A household generated from a spec: one to four members, each with a checking and a savings account (and a card), a
 * joint account some of them share, a loan, and the events of `Spec.events`. Every row has a label (truth.ts) and every
 * balance is the opening plus the rows, so the same rows prove through `reconcile`. The households of the invariant
 * tests are made here; the life events of the kit (events/*.ts) stay hand-made for the cases a spec cannot say.
 *
 * Everything is invented. Account numbers are made up at run time with a valid check digit, the names are common
 * ones with no person behind them.
 */
import { addDays, monthEnd } from "../../src/dates.ts";
import { type Account, type BalanceInput, type CategoryRule, NO_INPUTS, type Transaction } from "../../src/types.ts";
import { reconcile, type ReconcileBalance, type ReconcileResult } from "../../src/reconcile.ts";
import { byDateAndId, type HouseholdMember, type SharedAccount } from "../../../../tools/findings/households.ts";
import { frameOf } from "./frame.ts";
import { card, chk, drawOf, generateRows, ibanOf, JOINT, LOAN, OPENING_CENTS, OUTSIDER_HOLDER, type Plan, sav } from "./generate-rows.ts";
import type { GeneratedHousehold, Spec } from "./truth.ts";

export const GENERATED_TODAY = "2026-06-15";

/** Four invented names, the surname first as the banks write them. Two members never share a word. */
const NAMES = ["LEHTONEN AINO", "SALMINEN VEIKKO", "HEIKKINEN TUULA", "RANTANEN OSKARI"] as const;
const FIRST = ["Aino", "Veikko", "Tuula", "Oskari"] as const;

const sum = (txs: readonly Transaction[], accountId: string, upTo = "9999-12-31"): number => txs.filter((t) => t.accountId === accountId && t.bookingDate <= upTo).reduce((s, t) => s + t.amountCents, 0);

/** The spec with its defaults filled in. */
const full = (spec: Spec): Required<Omit<Spec, "events">> & { events: NonNullable<Spec["events"]> } => ({
  members: spec.members,
  months: spec.months ?? 14,
  joint: spec.joint ?? "none",
  loan: spec.loan ?? "none",
  cards: spec.cards ?? "none",
  events: spec.events ?? [],
  reference: spec.reference ?? true,
});

export function generateHousehold(input: Spec, seed: number, today = GENERATED_TODAY): GeneratedHousehold {
  const spec = full(input);
  const n = spec.members;
  const frame = frameOf(today, spec.months);
  const seats = Array.from({ length: n }, (_, i) => i);
  const members: HouseholdMember[] = seats.map((i) => ({
    id: `m${i + 1}`,
    label: FIRST[i]!,
    holder: NAMES[i]!,
    accountIds: [chk(i), sav(i), ...(spec.cards === "connected" ? [card(i)] : []), ...(i === 0 && spec.loan !== "none" ? [LOAN] : [])],
  }));
  const hasJoint = spec.joint !== "none";
  // the instance of a single member has no one to top a joint account up: the member holds it with a person who is no member
  const jointHolders = n === 1 ? [NAMES[0]!, OUTSIDER_HOLDER] : NAMES.slice(0, n);

  const accounts: Account[] = [
    ...seats.flatMap((i): Account[] => [
      { id: chk(i), name: "Käyttötili", iban: ibanOf(10 + i), currency: "EUR", type: "checking", holder: NAMES[i]! },
      { id: sav(i), name: "Säästötili", iban: ibanOf(20 + i), currency: "EUR", type: "savings", holder: NAMES[i]! },
      ...(spec.cards !== "connected" ? [] : [{ id: card(i), name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card", holder: NAMES[i]! } satisfies Account]),
    ]),
    ...(hasJoint ? [{ id: JOINT, name: "Yhteistili", iban: ibanOf(30), currency: "EUR", type: "checking", holder: jointHolders.join(", ") } satisfies Account] : []),
    ...(spec.loan !== "none" ? [{ id: LOAN, name: "Asuntolaina", iban: ibanOf(40), currency: "EUR", type: "loan", holder: NAMES[0]! } satisfies Account] : []),
  ];
  // the stranger of the namesake event pays from a bank account of their own
  const ibans = new Map([...accounts.filter((a) => a.iban).map((a): [string, string] => [a.id, a.iban!]), ["stranger", ibanOf(50)]]);
  const plan: Plan = { spec, frame, members, ibans, draw: drawOf(seed) };
  const { txs: made, truth } = generateRows(plan);
  const txs = byDateAndId(made);

  const shared: SharedAccount[] = hasJoint
    ? [{ accountId: JOINT, linkedBy: members.map((m) => m.id), ...(spec.joint === "said" && n > 1 ? { said: Object.fromEntries(members.map((m, i) => [m.id, 3 - (i % 2)])) } : {}) }]
    : [];

  const openingOf = (a: Account): number => (a.type === "credit_card" ? OPENING_CENTS.card : a.id === JOINT ? OPENING_CENTS.joint : a.type === "savings" ? OPENING_CENTS.sav : a.type === "loan" ? OPENING_CENTS.loan : OPENING_CENTS.chk);
  const openings = new Map(accounts.map((a) => [a.id, openingOf(a)]));
  const balances: BalanceInput[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    // a loan's balance is not read from the bank in the kit's households: its rows are the instalments' mirror
    balanceCents: a.type === "loan" ? null : openingOf(a) + sum(txs, a.id),
    ownerName: null,
    balanceAt: today,
  }));

  // the bank's closing balance of the last three complete months and of the day before today, as `reconcile` reads them
  const refs = [...frame.complete.slice(-3).map((m) => monthEnd(m)), addDays(today, -1)];
  const anchors = new Map<string, readonly ReconcileBalance[]>(
    accounts
      .filter((a) => a.type !== "loan")
      .map((a) => [
        a.id,
        refs.map((ref) => ({ day: addDays(ref, 1), type: "CLBD", referenceDate: spec.reference ? ref : null, cents: openingOf(a) + sum(txs, a.id, ref), fetchedAt: `${addDays(ref, 1)}T06:00:00.000Z`, source: "bank" })),
      ]),
  );

  const rules: CategoryRule[] = spec.events.includes("benefit-rule") ? [{ field: "merchant_exact", pattern: "Kela", category: "health", priority: 10 }] : [];
  return {
    name: `generated:${n}:${spec.joint}:${spec.loan}:${spec.cards}:${spec.events.join("+") || "base"}:${seed}`,
    today,
    txs,
    accounts,
    balances,
    rules,
    inputs: NO_INPUTS,
    industry: new Map(),
    spec: input,
    members,
    shared,
    truth,
    anchors,
    openings,
  };
}

/** What `reconcile` says of an account's stored rows against the bank balances of the household. Null for an account it does not reconcile. */
export function proveAccount(h: GeneratedHousehold, accountId: string): ReconcileResult | null {
  const account = h.accounts.find((a) => a.id === accountId)!;
  const own = h.txs.filter((t) => t.accountId === accountId);
  const rows = own.map((t) => ({ bookingDate: t.bookingDate, amountCents: t.amountCents, status: "booked" as const, importedAt: `${t.bookingDate}T20:00:00.000Z` }));
  // the rows were asked for from the first day any of them has
  const historyFrom = own.reduce<string | null>((a, t) => (a === null || t.bookingDate < a ? t.bookingDate : a), null);
  return reconcile(account, rows, h.anchors.get(accountId) ?? [], { historyFrom, foreignDays: [], today: h.today });
}

/** Households that cover the spec's axes: every member count, each joint, loan and card shape, and each event on its own. */
export function generatedSet(seed = 1): GeneratedHousehold[] {
  const out: GeneratedHousehold[] = [];
  for (const members of [1, 2, 3, 4] as const) {
    out.push(generateHousehold({ members }, seed));
    out.push(generateHousehold({ members, joint: "unknown", loan: "checking", cards: "connected" }, seed));
    out.push(generateHousehold({ members, joint: "said", loan: "savings", cards: "unconnected", events: ["benefit-rule", "payment-app", "namesake", "member-fee", "refund"] }, seed));
  }
  out.push(generateHousehold({ members: 2, joint: "said", loan: "joint", cards: "connected" }, seed));
  return out;
}
