/**
 * The payees the app knows by trade: data, not code. Each entry is a folded name (the bank dialect, whole words, A to Z
 * and digits; a name with many spellings is a list), the category its rows get, what the rows form (kind) and, for a
 * home's payment, what Asuminen calls it. categorize.ts reads the entries as rules for money out, wording.ts
 * (`housingCharge`) their home kind, and party-kind.ts tells a company from a person by them. A name that is also a
 * person's (Helen, Alva) is listed with its company form only; the false friends are in test/payees.test.ts.
 */

/** What the rows of a payee form: a contract with a monthly cost, a bill, a card's bill or a loan's payment. */
type PayeeKind = "contract" | "bill" | "card_bill" | "loan";

/** What a home's payment is: the ids of `housingCharge`, of which the payee list names these. "energy": it sells heat and electricity, and the words of the payment say which. */
type PayeeHome = "electricity" | "district_heat" | "energy" | "water" | "waste";

interface Payee {
  id: string;
  /** The spellings of the folded name, as regex fragments. */
  names: readonly string[];
  category: string;
  kind: PayeeKind;
  home?: PayeeHome;
  /** The entry decides before the debt, travel and card rules: a lessor's name holds words they read (Nordea Rahoitus, Sixt). */
  first?: true;
  /** A bank or a finance company: the entry holds only where this word stands anywhere in the row too (payee or text). */
  needs?: string;
  /** The name is looked for in the payee only, never in the text of a purchase (a shop sells "JATEPUSSIT"). */
  payeeOnly?: true;
}

const leasing = (id: string, ...names: string[]): Payee => ({ id, names, category: "leasing", kind: "contract", first: true });
const bankLeasing = (id: string, ...names: string[]): Payee => ({ ...leasing(id, ...names), needs: "LEASING[A-Z]*" });
const utility = (id: string, home: PayeeHome, ...names: string[]): Payee => ({ id, names, category: "utilities", kind: "bill", home });

export const PAYEES: readonly Payee[] = [
  // ── car leasing: a lessor's own name, or a bank's with the word for a lease anywhere in the row ──
  leasing("arval", "ARVAL"),
  leasing("ayvens", "AYVENS"),
  leasing("ald", "ALD AUTOMOTIVE"),
  leasing("leaseplan", "LEASE ?PLAN"),
  leasing("sixt_leasing", "SIXT LEASING"),
  leasing("carlease", "CARLEASE", "CAR LEASE"),
  leasing("op_leasing", "OP[ -]?(?:AUTO)?LEASING"),
  bankLeasing("handelsbanken_leasing", "HANDELSBANKEN"),
  bankLeasing("nordea_leasing", "NORDEA RAHOITUS", "NORDEA FINANCE"),
  bankLeasing("santander_leasing", "SANTANDER"),
  leasing("lease_word", "[A-Z]*AUTOLEASING", "YKSITYISLEASING", "HUOLTOLEASING", "AUTON LEASING"),

  // ── energy companies: the electricity sellers, and those that sell heat and electricity (the text says which) ──
  utility("alva", "electricity", "ALVA OY", "ALVA OYJ", "ALVA-YHTIOT", "ALVA YHTIOT"),
  utility("tampereen_sahkolaitos", "electricity", "TAMPEREEN SAHKOLAITOS"),
  utility("vantaan_energia", "energy", "VANTAAN ENERGIA"),
  utility("turku_energia", "energy", "TURKU ENERGIA"),
  utility("kuopion_energia", "energy", "KUOPION ENERGIA"),
  utility("oulun_energia", "energy", "OULUN ENERGIA"),
  utility("lahti_energia", "energy", "LAHTI ENERGIA"),

  // ── water: a utility named so; HSY sells water and takes waste, and its text says which ──
  utility("water", "water", "[A-Z]*VESIHUOLTO[A-Z]*", "[A-Z]*VESILAITOS[A-Z]*", "VESIOSUUSKUNTA", "[A-Z]*VESIMAKSU[A-Z]*", "[A-Z]+N VESI"),
  utility("hsy", "water", "HSY"),

  // ── waste ──
  utility("mustankorkea", "waste", "MUSTANKORKEA"),
  utility("kiertokapula", "waste", "KIERTOKAPULA"),
  utility("lassila_tikanoja", "waste", "LASSILA & TIKANOJA", "L&T"),
  utility("remeo", "waste", "REMEO"),
  utility("rosk_n_roll", "waste", "ROSK'?N ?ROLL"),
  utility("jatekukko", "waste", "JATEKUKKO"),
  utility("kiertokaari", "waste", "KIERTOKAARI"),
  utility("ekokem", "waste", "EKOKEM", "FORTUM WASTE[A-Z ]*"),
  utility("urbaser", "waste", "URBASER"),
  { ...utility("jate_word", "waste", "JATE[A-Z]*"), payeeOnly: true },
];

const whole = (names: readonly string[]) => new RegExp(String.raw`(?<![A-Z0-9])(?:${names.join("|")})(?![A-Z0-9])`);
const COMPILED = PAYEES.map((payee) => ({ payee, re: whole(payee.names), needs: payee.needs ? whole([payee.needs]) : null }));

/** The first entry that names the folded text: the payee of a row, or the text a bank gave. A bank's entry needs its lease word too, so the name alone names none. */
export const payeeFor = (folded: string): Payee | null => COMPILED.find(({ re, needs }) => re.test(folded) && !needs)?.payee ?? null;

/** From this sum on, money in from a lessor is a car sold, not a refund (as `dealerCategory` of categorize.ts reads a car's price). */
const SALE_CENTS = 150_000;
const SALE_TEXT = whole(["KAUPPAHINTA"]);

/**
 * The rules of the list for categorize.ts. `first`: the lessors for money out, which decide before the debt rules. `later`:
 * the other payees for money either way, and the lessors for money in, after the rules of pay, benefits and sales: money
 * in from a payee is a refund of its own category (negative spending), unless it is a car sold (KAUPPAHINTA or a sum of
 * `SALE_CENTS` or more), which no rule here files. `fold` is merchant.ts's, to read the payee fields of a row.
 */
export function payeeRules(fold: (text: string) => string) {
  type Entry = (typeof COMPILED)[number];
  type Row = { merchant: string; counterparty: string | null; amountCents: number };
  const rule = ({ payee, re, needs }: Entry, direction?: "in" | "out") => ({
    category: payee.category,
    ...(direction ? { direction } : {}),
    re,
    when: (text: string, input: Row) =>
      (!needs || needs.test(text)) &&
      (!payee.payeeOnly || [input.merchant, input.counterparty].some((name) => !!name && re.test(fold(name)))) &&
      (direction !== "in" || (!SALE_TEXT.test(text) && input.amountCents < SALE_CENTS)),
  });
  const lessors = COMPILED.filter(({ payee }) => payee.first);
  return {
    first: lessors.map((entry) => rule(entry, "out")),
    later: [...COMPILED.filter(({ payee }) => !payee.first).map((entry) => rule(entry)), ...lessors.map((entry) => rule(entry, "in"))],
  };
}

/** Heat, water and waste come from the same companies and are no electricity. */
export const isHeatWaterOrWaste = (folded: string) => ["LAMPO", "VESI", "JATE"].some((word) => folded.includes(word));

const WASTE_TEXT = whole(["JATE[A-Z]*"]);
const HEAT_TEXT = whole(["KAUKOLAM(?:PO|MO)[A-Z]*"]);
const HEAT_WORD = whole(["[A-Z]*LAMPO[A-Z]*"]);
const WATER_TEXT = whole(["VESI[A-Z]*"]);
const ELECTRICITY_TEXT = whole(["SAHKO[A-Z]*"]);

/**
 * What a home's payment is by its folded text (the payee and the payment's words) and its folded payee: the words of
 * the payment first, then the payee list. A bill that names heat, water or waste is no electricity, a company that
 * sells heat and electricity has no kind by its name, and HSY bills water unless the text names waste. Null: the list
 * says nothing.
 */
export function homeKindOf(all: string, payee: string): PayeeHome | null {
  if (WASTE_TEXT.test(all)) return "waste";
  if (HEAT_TEXT.test(all)) return "district_heat";
  const home = COMPILED.find(({ payee: p, re }) => p.home && re.test(payee))?.payee.home;
  if (!home || home === "water") return home ?? null;
  if (home === "waste") return WATER_TEXT.test(all) ? null : home;
  if (home === "energy") return HEAT_WORD.test(all) ? "district_heat" : !isHeatWaterOrWaste(all) && ELECTRICITY_TEXT.test(all) ? "electricity" : null;
  return isHeatWaterOrWaste(all) ? null : home;
}
