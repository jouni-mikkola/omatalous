/**
 * The rows of a generated household (generate.ts): a monthly base for each member, and the events of the spec. Every
 * row is written with its label (truth.ts) in the same call, so the two cannot drift apart. Names and numbers are
 * invented; the wording is the Finnish banks' own, as in the rest of the kit.
 */
import type { RowSpec } from "./frame.ts";
import { type Frame, rows } from "./frame.ts";
import type { EventId, Spec, Truth } from "./truth.ts";
import type { HouseholdMember } from "../../../../tools/findings/households.ts";
import type { Transaction } from "../../src/types.ts";

export const JOINT = "joint";
export const LOAN = "loan";
export const chk = (i: number): string => `chk-${i}`;
export const sav = (i: number): string => `sav-${i}`;
export const card = (i: number): string => `card-${i}`;

export const RENT_CENTS = 90_000;
export const LOAN_CENTS = 61_240;
export const TOP_UP_CENTS = 20_000;
export const JOINT_SHARE_CENTS = 45_000;
const OPEN_CENTS = 4_000_000;
/** What each account held before its first row: enough that no account of a generated household runs dry. */
export const OPENING_CENTS = { chk: OPEN_CENTS, sav: 3_000_000, joint: OPEN_CENTS, card: 0, loan: -20_000_000 } as const;

/** A Finnish account number made up from `n`: the bank code of the examples, `n` as the account, a valid check digit. */
export function ibanOf(n: number): string {
  const bban = `123456${String(n).padStart(8, "0")}`;
  const check = 98n - (BigInt(`${bban}151800`) % 97n);
  return `FI${String(check).padStart(2, "0")}${bban}`;
}

/** The labels of the partner who is no member of the instance, on a joint account a single member holds. */
export const OUTSIDER_HOLDER = "TESTAAJA JUHANI";

export interface Plan {
  spec: Spec;
  frame: Frame;
  members: readonly HouseholdMember[];
  /** The IBAN of each account that has one, by account id. */
  ibans: ReadonlyMap<string, string>;
  /** A draw in [0, 1): the same sequence for the same seed. */
  draw: () => number;
}

/** The mulberry32 generator: small, and the same on every machine. */
export function drawOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A maker of rows that records the label of each one it makes. A row dated after today is not made, and neither is its label. */
function ledger(today: string) {
  const { out, add } = rows("g", today);
  const truth = new Map<string, Truth>();
  const put = (r: RowSpec, t: Truth): string | null => {
    const before = out.length;
    add(r);
    if (out.length === before) return null;
    const id = out[before]!.id;
    truth.set(id, { ...t });
    return id;
  };
  /** Two legs of one movement, each with its label; the legs point at each other. */
  const pair = (a: RowSpec, ta: Truth, b: RowSpec, tb: Truth): void => {
    const first = put(a, ta);
    const second = put(b, tb);
    if (first && second) {
      truth.get(first)!.pair = second;
      truth.get(second)!.pair = first;
    }
  };
  return { out, truth, put, pair };
}

const has = (plan: Plan, event: EventId): boolean => plan.spec.events?.includes(event) ?? false;

/** The rows and labels of a household. The ids are `g-00000`… in the order the rows are made. */
export function generateRows(plan: Plan): { txs: Transaction[]; truth: Map<string, Truth> } {
  const { spec, frame: f, members, ibans, draw } = plan;
  const { out, truth, put, pair } = ledger(f.today);
  const iban = (account: string): string => ibans.get(account)!;
  const holders = members.map((m) => m.holder);
  const charged = new Map<string, number>();
  const loanFrom = spec.loan === "savings" ? sav(0) : spec.loan === "joint" ? JOINT : chk(0);

  for (const [mi, m] of f.months.entries()) {
    const previous = f.months[mi - 1];
    for (const [i, member] of members.entries()) {
      const who = member.id;
      const name = holders[i]!;
      const shopAccount = spec.cards === "connected" ? card(i) : chk(i);
      put({ date: f.on(m, 25), cents: 310_000 + 25_000 * i, counterparty: `TYONANTAJA ${i + 1} OY`, description: "PALKKA", account: chk(i) }, { kind: "salary", flow: "income", member: who, event: null });
      for (const day of [6, 13, 21]) {
        const cents = -(3000 + Math.floor(draw() * 5000));
        const date = f.on(m, day + i);
        const row = { date, cents, counterparty: shopAccount === chk(i) ? "K-MARKET SORNAINEN" : null, description: shopAccount === chk(i) ? "KORTTIOSTO" : "K-MARKET SORNAINEN HELSINKI", mcc: "5411", account: shopAccount };
        if (put(row, { kind: "shop", flow: "consumption", member: who, event: null }) && shopAccount === card(i)) charged.set(`${shopAccount}|${m}`, (charged.get(`${shopAccount}|${m}`) ?? 0) - cents);
      }
      pair(
        { date: f.on(m, 26), cents: -TOP_UP_CENTS, counterparty: name, description: "OMA SIIRTO", iban: iban(sav(i)), account: chk(i) },
        { kind: "own_transfer", flow: "transfer", member: who, event: null },
        { date: f.on(m, 26), cents: TOP_UP_CENTS, counterparty: name, description: "OMA SIIRTO", iban: iban(chk(i)), account: sav(i) },
        { kind: "own_transfer", flow: "transfer", member: who, event: null },
      );
      if (spec.joint && spec.joint !== "none" && members.length > 1) {
        pair(
          { date: f.on(m, 3), cents: -JOINT_SHARE_CENTS, counterparty: name, description: "OMA SIIRTO", iban: iban(JOINT), account: chk(i) },
          { kind: "own_transfer", flow: "transfer", member: who, event: null },
          { date: f.on(m, 3), cents: JOINT_SHARE_CENTS, counterparty: name, description: "OMA SIIRTO", iban: iban(chk(i)), account: JOINT },
          { kind: "own_transfer", flow: "transfer", member: null, event: null },
        );
      }
      if (spec.cards === "connected" && previous) {
        const bill = charged.get(`${card(i)}|${previous}`) ?? 0;
        if (bill) {
          pair(
            { date: f.on(m, 10), cents: -bill, counterparty: "NORDEA RAHOITUS SUOMI OY", description: "NORDEA GOLD LASKU", account: chk(i) },
            { kind: "card_bill", flow: "transfer", member: who, event: null },
            { date: f.on(m, 10), cents: bill, counterparty: "NORDEA RAHOITUS SUOMI OY", description: "MAKSU, KIITOS", account: card(i) },
            { kind: "card_bill", flow: "transfer", member: who, event: null },
          );
        }
      }
    }
    // the rent comes from the joint account when there is one: the members' top-ups pay it
    const rentFrom = spec.joint && spec.joint !== "none" ? JOINT : chk(0);
    put({ date: f.on(m, 2), cents: -RENT_CENTS, counterparty: "SATO OYJ", description: "VUOKRA 4471", account: rentFrom }, { kind: "rent", flow: "consumption", member: rentFrom === JOINT ? null : members[0]!.id, event: null });
    if (spec.loan && spec.loan !== "none") {
      if (spec.loan === "savings") {
        pair(
          { date: f.on(m, 4), cents: -LOAN_CENTS, counterparty: holders[0]!, description: "OMA SIIRTO", iban: iban(sav(0)), account: chk(0) },
          { kind: "own_transfer", flow: "transfer", member: members[0]!.id, event: "loan-from-savings" },
          { date: f.on(m, 4), cents: LOAN_CENTS, counterparty: holders[0]!, description: "OMA SIIRTO", iban: iban(chk(0)), account: sav(0) },
          { kind: "own_transfer", flow: "transfer", member: members[0]!.id, event: "loan-from-savings" },
        );
      }
      pair(
        { date: f.on(m, 5), cents: -LOAN_CENTS, counterparty: "NORDEA BANK ABP", description: "LAINANLYHENNYS 1234567", iban: iban(LOAN), account: loanFrom },
        { kind: "loan_instalment", flow: "debt", member: loanFrom === JOINT ? null : members[0]!.id, event: spec.loan === "savings" ? "loan-from-savings" : null },
        { date: f.on(m, 5), cents: LOAN_CENTS, counterparty: "NORDEA BANK ABP", description: "SUORITUS", account: LOAN },
        { kind: "loan_mirror", flow: "mirror", member: null, event: null },
      );
    }
    if (spec.cards === "unconnected") {
      const first = members[0]!;
      put({ date: f.on(m, 10), cents: -(20_000 + Math.floor(draw() * 8000)), counterparty: "NORDEA RAHOITUS SUOMI OY", description: "LASKU 12345", account: chk(0) }, { kind: "card_bill", flow: "debt", member: first.id, event: null });
    }
    eventRows(plan, m, put, pair);
  }
  return { txs: out, truth };
}

type Put = (r: RowSpec, t: Truth) => string | null;
type Pair = (a: RowSpec, ta: Truth, b: RowSpec, tb: Truth) => void;

/** The rows of the spec's events in month `m`. */
function eventRows(plan: Plan, m: string, put: Put, pair: Pair): void {
  const { frame: f, members, ibans } = plan;
  const first = members[0]!;
  const me = first.id;
  if (has(plan, "benefit-rule")) {
    // the household pays this payee too, and has a rule that files what it pays under health
    put({ date: f.on(m, 15), cents: 9480, counterparty: "KELA", description: "LAPSILISA", account: chk(0) }, { kind: "benefit", flow: "income", member: me, event: "benefit-rule" });
    put({ date: f.on(m, 20), cents: -1600, counterparty: "KELA", description: "OMAVASTUU", account: chk(0) }, { kind: "business", flow: "consumption", member: me, event: "benefit-rule" });
  }
  if (has(plan, "payment-app")) {
    const plain = { kind: "business", flow: "consumption", member: me, event: "payment-app" } as const;
    put({ date: f.on(m, 9), cents: -2400, counterparty: "MOBILEPAY KAHVILA SIPULI OY", description: "MOBILEPAY", account: chk(0) }, plain);
    put({ date: f.on(m, 10), cents: -2400, counterparty: "KAHVILA SIPULI OY", description: "KORTTIOSTO", mcc: "5814", account: chk(0) }, plain);
    put({ date: f.on(m, 16), cents: -3000, counterparty: "MOBILEPAY KORHONEN LIISA", description: "MOBILEPAY", account: chk(0) }, { kind: "person", flow: "consumption", member: me, event: "payment-app" });
  }
  if (has(plan, "namesake") && members.length > 1) {
    // a stranger with a member's name pays the household back: not the member's own money
    put({ date: f.on(m, 12), cents: 2500, counterparty: members[1]!.holder, description: "SIIRTO-MAKSU", iban: ibans.get("stranger")!, account: chk(0) }, { kind: "person", flow: "income", member: me, event: "namesake" });
  }
  if (has(plan, "member-fee") && members.length > 1) {
    const fee = 150;
    const amount = 8000;
    pair(
      { date: f.on(m, 14), cents: -(amount + fee), counterparty: members[1]!.holder, description: "SIIRTO", iban: ibans.get(chk(1))!, account: chk(0) },
      { kind: "member_transfer", flow: "transfer", member: me, event: "member-fee", feeCents: fee },
      { date: f.on(m, 14), cents: amount, counterparty: first.holder, description: "SIIRTO", iban: ibans.get(chk(0))!, account: chk(1) },
      { kind: "member_transfer", flow: "transfer", member: members[1]!.id, event: "member-fee" },
    );
  }
  if (has(plan, "refund")) {
    put({ date: f.on(m, 8), cents: -9900, counterparty: "ZALANDO SE", description: "KORTTIOSTO", mcc: "5651", account: chk(0) }, { kind: "shop", flow: "consumption", member: me, event: "refund" });
    put({ date: f.on(m, 22), cents: 9900, counterparty: "ZALANDO SE", description: "PALAUTUS", mcc: "5651", account: chk(0) }, { kind: "refund", flow: "consumption", member: me, event: "refund" });
  }
}
