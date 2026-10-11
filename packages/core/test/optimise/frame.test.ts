import { describe, expect, it } from "vitest";
import { createContext } from "../../src/analysis/context.ts";
import { formatEur } from "../../src/analysis/format.ts";
import { addDays, addMonths, monthRange } from "../../src/dates.ts";
import {
  accountsBefore,
  annualise,
  type Area,
  type AreaInput,
  baselineOf,
  buildOptimise,
  type Check,
  certaintyOf,
  type Fact,
  factFrom,
  findingId,
  type FindingDraft,
  type FindingState,
  GATE_YEARLY_CENTS,
  inputDefOf,
  levelWithoutOneOffs,
  measureSums,
  numbersIn,
  type OptimiseData,
  type OptimiseInput,
  optimiseEnd,
  parseFindingId,
  parseInputValue,
  proposedFrom,
  INPUT_DEFS,
  valueOf,
  type Weakness,
  yearWindow,
} from "../../src/optimise/index.ts";
import type { Account, Transaction } from "../../src/types.ts";
import { tx } from "../helpers.ts";
import { enrich } from "./household.ts";

const TODAY = "2026-10-15";
const ACCOUNTS: Account[] = [
  { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" },
  { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" },
];

/** Five grocery sums that make 250 € a month and no fixed-amount series. */
const GROCERIES = [-4500, -5200, -4800, -5500, -5000];

/** `months` complete months before October 2026: weekly groceries and monthly pay on the checking account. */
function ctxWith(months: number, extra: Transaction[] = []) {
  const txs: Transaction[] = [];
  for (const m of monthRange(addMonths("2026-10", -months), "2026-10")) {
    ["01", "08", "15", "22", "29"].forEach((d, i) => {
      if (`${m}-${d}` <= TODAY) txs.push(tx({ bookingDate: `${m}-${d}`, amountCents: GROCERIES[i]!, merchant: "K-Market Kamppi", mcc: "5411" }));
    });
    if (`${m}-15` <= TODAY) txs.push(tx({ bookingDate: `${m}-15`, amountCents: 300000, merchant: "Työnantaja Oy", description: "PALKKA" }));
  }
  txs.push(...extra);
  return createContext(enrich(txs, ACCOUNTS), ACCOUNTS, TODAY);
}

const CTX12 = ctxWith(12);
const weak = (id: Weakness["id"], reason = `Heikkous ${id}.`): Weakness => ({ id, reason });

interface DraftOpts {
  kind?: string;
  subject?: string | null;
  mid?: number | null;
  low?: number;
  high?: number;
  decideBy?: string | null;
  weaknesses?: Weakness[];
  shared?: boolean;
  claims?: string[];
  rows?: string[];
  needs?: string[];
  facts?: string[];
  calc?: FindingDraft["calc"];
}

function draft(o: DraftOpts = {}): FindingDraft {
  const kind = o.kind ?? "rise";
  const subject = o.subject === undefined ? "Elisa" : o.subject;
  const mid = o.mid === undefined ? 30000 : o.mid;
  return {
    id: findingId("subscriptions", kind, subject),
    area: "subscriptions",
    kind,
    subject,
    title: mid === null ? `${subject}: sopimus uusiutuu ${o.decideBy}.` : `${subject}: nousu on ${formatEur(mid, false)} vuodessa.`,
    action: "Neuvottele hinta.",
    effort: "minuutteja",
    euros: mid === null ? null : { lowCents: o.low ?? Math.round(mid * 0.8), midCents: mid, highCents: o.high ?? Math.round(mid * 1.2), assumption: "Jos hinta palaa entiselleen." },
    decideBy: o.decideBy ?? null,
    weaknesses: o.weaknesses ?? [],
    shared: o.shared ?? false,
    calc: o.calc ?? [{ label: "Nousu vuodessa", value: mid === null ? "" : formatEur(mid, false) }],
    rows: o.rows ?? [],
    struck: [],
    claims: o.claims ?? [`merchant:${subject}`],
    measure: { kind: "merchants", keys: [subject ?? ""], perYear: 12 },
    ...(o.needs ? { needs: o.needs } : {}),
    facts: o.facts ?? [],
  };
}

const CHECKS: Check[] = [
  { id: "subscriptions:rise", label: "Hinnannousut", status: "clear" },
  { id: "subscriptions:renewal", label: "Uusiutuvat sopimukset", status: "clear" },
];

function area(drafts: FindingDraft[] | ((a: AreaInput) => FindingDraft[]), checks: Check[] | ((a: AreaInput) => Check[]) = CHECKS, id: Area["id"] = "subscriptions"): Area {
  return {
    id,
    label: "Puhelin ja tilaukset",
    assess: (a) => ({ findings: typeof drafts === "function" ? drafts(a) : drafts, checks: typeof checks === "function" ? checks(a) : checks }),
  };
}

const run = (ctx: OptimiseInput["ctx"], areas: Area | Area[], extra: Partial<OptimiseInput> = {}) =>
  buildOptimise({ ctx, balances: [], areas: Array.isArray(areas) ? areas : [areas], ...extra });
const shown = (d: OptimiseData) => d.areas.flatMap((a) => a.findings);
const ids = (fs: readonly { id: string }[]) => fs.map((f) => f.id);
const state = (findingId: string, s: Partial<FindingState>): FindingState => ({
  findingId,
  status: "dismissed",
  reason: null,
  until: null,
  effectiveDate: null,
  midCents: null,
  baseline: null,
  decidedAt: "2026-09-01T10:00:00.000Z",
  ...s,
});

describe("optimise frame: what is shown", () => {
  it("shows three findings per area, largest weighted mid first, and counts the rest", () => {
    const drafts = [150, 500, 300, 200, 400].map((e, i) => draft({ subject: `S${i}`, mid: e * 100 }));
    const data = run(CTX12, area(drafts));
    expect(ids(data.areas[0]!.findings)).toEqual(["subscriptions:rise:S1", "subscriptions:rise:S4", "subscriptions:rise:S2"]);
    expect(data.areas[0]!.more).toBe(2);
    expect(data.checked).toEqual({ total: 2, findings: 5, unavailable: 0 });
    expect(data.areas[0]!.checks.find((c) => c.id === "subscriptions:rise")!.status).toBe("finding");
  });

  it("sums the headline without a finding that shares over half its claims with a larger one", () => {
    const data = run(
      CTX12,
      area([
        draft({ subject: "A", mid: 50000, claims: ["merchant:A", "merchant:B"] }),
        draft({ subject: "B", mid: 30000, claims: ["merchant:A", "merchant:B", "merchant:C"] }),
        draft({ subject: "C", mid: 20000, claims: ["merchant:A", "merchant:D"] }),
      ]),
    );
    expect(data.headline).toEqual({ lowCents: 40000 + 16000, midCents: 70000, highCents: 60000 + 24000, count: 2 });
  });

  it("leaves shared and matala findings out of the headline and matala out of the next 60 days", () => {
    const data = run(
      CTX12,
      area([
        draft({ subject: "Yhtiö", mid: 90000, shared: true }),
        draft({ subject: "Heikko", mid: 80000, decideBy: addDays(TODAY, 10), weaknesses: [weak("estimate"), weak("sample")] }),
        draft({ subject: "Vahva", mid: 20000 }),
      ]),
    );
    expect(data.headline.midCents).toBe(20000);
    const matala = shown(data).find((f) => f.subject === "Heikko")!;
    expect(matala.certainty).toEqual({ level: "matala", reason: "Heikkous estimate." });
    expect(ids(shown(data))[2]).toBe(matala.id);
    expect(data.soon).toEqual([]);
  });

  it("drops a finding under the gate and the check reads clear", () => {
    const data = run(CTX12, area([draft({ subject: "Pieni", mid: GATE_YEARLY_CENTS - 1 }), draft({ kind: "renewal", subject: "Raja", mid: GATE_YEARLY_CENTS })]));
    expect(ids(shown(data))).toEqual(["subscriptions:renewal:Raja"]);
    expect(data.areas[0]!.checks.map((c) => c.status)).toEqual(["clear", "finding"]);
  });

  it("steps certainty down per weakness, names the first in rule order and hides at three", () => {
    expect(certaintyOf([])).toEqual({ level: "korkea", reason: "Laskettu omista tiedoista." });
    expect(certaintyOf([weak("wide_range"), weak("estimate")])).toEqual({ level: "matala", reason: "Heikkous estimate." });
    expect(certaintyOf([weak("estimate"), weak("estimate")])?.level).toBe("keskitaso");
    const data = run(CTX12, area([draft({ weaknesses: [weak("estimate"), weak("sample"), weak("gap")] })], [{ ...CHECKS[0]!, status: "finding" }]));
    expect(shown(data)).toEqual([]);
    expect(data.areas[0]!.checks[0]!.status).toBe("no_data");
    expect(data.checked.unavailable).toBe(1);
  });

  it("adds a step for a range wider than mid", () => {
    const f = shown(run(CTX12, area([draft({ mid: 30000, low: 10000, high: 50000 })])))[0]!;
    expect(f.certainty).toEqual({ level: "keskitaso", reason: "Vaihteluväli on suurempi kuin arvio." });
  });

  it("orders areas by mid times the certainty weight", () => {
    const strong = area([draft({ mid: 20000 })], CHECKS, "subscriptions");
    const weakArea: Area = { ...area([], [], "loans"), assess: () => ({ findings: [{ ...draft({ mid: 30000, weaknesses: [weak("estimate")] }), id: "loans:margin", area: "loans", kind: "margin" }], checks: [] }) };
    const empty = area([], [], "bank");
    const data = run(CTX12, [empty, weakArea, strong]);
    expect(data.areas.map((a) => [a.id, a.weightCents])).toEqual([
      ["subscriptions", 20000],
      ["loans", 18000],
      ["bank", 0],
    ]);
  });

  it("puts a deadline within 60 days in the next 60 days, soonest first", () => {
    const data = run(
      CTX12,
      area([
        draft({ kind: "renewal", subject: "Myöhemmin", mid: null, decideBy: addDays(TODAY, 40) }),
        draft({ kind: "renewal", subject: "Pian", mid: null, decideBy: addDays(TODAY, 5) }),
        draft({ kind: "renewal", subject: "Kaukana", mid: null, decideBy: addDays(TODAY, 61) }),
      ]),
    );
    expect(ids(data.soon)).toEqual(["subscriptions:renewal:Pian", "subscriptions:renewal:Myöhemmin"]);
    expect(data.headline.count).toBe(0);
  });
});

describe("optimise frame: history rule", () => {
  const both = () => area([draft({ mid: 30000 }), draft({ kind: "renewal", subject: "Määräaika", mid: null, decideBy: addDays(TODAY, 20) })]);

  it("shows only deadlines under three complete months", () => {
    const data = run(ctxWith(2), both());
    expect(data.months).toBe(2);
    expect(ids(shown(data))).toEqual(["subscriptions:renewal:Määräaika"]);
    expect(data.areas[0]!.checks[0]!.status).toBe("no_data");
  });

  it("shows no euro figure under six complete months", () => {
    expect(ids(shown(run(ctxWith(5), both())))).toEqual(["subscriptions:renewal:Määräaika"]);
  });

  it("annualises 6 to 11 months with one certainty step", () => {
    const f = shown(run(ctxWith(8), both())).find((x) => x.euros)!;
    expect(f.certainty).toEqual({ level: "keskitaso", reason: "Vuosiluku on laskettu 8 kuukauden tiedoista." });
    expect(annualise([100, 100, 100, 100, 100, 100, 100, 100])).toEqual({ yearlyCents: 1200, months: 8, weakness: { id: "short_history", reason: "Vuosiluku on laskettu 8 kuukauden tiedoista." } });
    expect(annualise([1, 2, 3, 4, 5])).toBeNull();
    expect(annualise(Array.from({ length: 14 }, (_, i) => i))?.yearlyCents).toBe(2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12 + 13);
  });

  it("takes the window from the last complete month", () => {
    expect(optimiseEnd("2026-10-15")).toBe("2026-09-30");
    expect(optimiseEnd("2026-03-01")).toBe("2026-02-28");
    const w = yearWindow(ctxWith(14), optimiseEnd(TODAY));
    expect(w.months).toEqual(monthRange("2025-10", "2026-09"));
    expect(w.from).toBe("2025-10-01");
  });
});

describe("optimise frame: states", () => {
  const at = (mid: number) => area([draft({ subject: "Elisa", mid })]);
  const id = "subscriptions:rise:Elisa";

  it("brings a dismissed finding back only when mid grew over 50 % and over 100 €", () => {
    const states = [state(id, { status: "dismissed", reason: "compared", midCents: 30000 })];
    const back = run(CTX12, at(46000), { states });
    expect(shown(back)[0]).toMatchObject({ id, reopened: true });
    const quiet = run(CTX12, at(44000), { states });
    expect(shown(quiet)).toEqual([]);
    expect(quiet.dismissed.map((d) => [d.finding.id, d.state.reason])).toEqual([[id, "compared"]]);
    // 60 % more, but only 90 € more
    const small = run(CTX12, at(24000), { states: [state(id, { status: "dismissed", midCents: 15000 })] });
    expect(shown(small)).toEqual([]);
  });

  it("hides a snoozed finding until its day", () => {
    const hidden = run(CTX12, at(30000), { states: [state(id, { status: "snoozed", until: addDays(TODAY, 1) })] });
    expect(shown(hidden)).toEqual([]);
    expect(hidden.areas[0]!.checks[0]!.status).toBe("finding");
    expect(ids(shown(run(CTX12, at(30000), { states: [state(id, { status: "snoozed", until: TODAY })] })))).toEqual([id]);
  });

  it("moves a done finding to Jo hoidossa, out of the headline, and keeps it there after the data stops showing it", () => {
    const states = [state(id, { status: "done", effectiveDate: "2026-09-01", midCents: 30000 }), state("subscriptions:rise:Vanha", { status: "done", midCents: 20000 })];
    const data = run(CTX12, at(30000), { states });
    expect(shown(data)).toEqual([]);
    expect(data.headline.count).toBe(0);
    expect(data.done.map((d) => [d.state.findingId, d.finding?.id ?? null])).toEqual([
      [id, id],
      ["subscriptions:rise:Vanha", null],
    ]);
    expect(data.areas[0]!.checks[0]!.status).toBe("finding");
  });

  it("measures the default baseline over six complete months before the day", () => {
    const f = { measure: { kind: "merchants" as const, keys: ["K-Market Kamppi"] } };
    const base = baselineOf(CTX12, f, "2026-09-10");
    expect(base.map((b) => b.month)).toEqual(monthRange("2026-03", "2026-08"));
    expect(base.find((b) => b.month === "2026-08")!.cents).toBe(5 * 5000);
    expect(baselineOf(CTX12, { measure: { kind: "none", keys: [] } }, "2026-09-10")).toEqual([]);
    const months = yearWindow(CTX12, optimiseEnd(TODAY)).months;
    expect(measureSums(CTX12, { kind: "category", keys: ["groceries"] }, months).map((m) => m.cents)).toEqual(months.map(() => 25000));
  });

  it("parses a finding id the way areas make them", () => {
    expect(parseFindingId("subscriptions:rise:K-Market Kamppi")).toEqual({ area: "subscriptions", kind: "rise", subject: "K-Market Kamppi" });
    expect(parseFindingId("tax:household_deduction:2026")).toEqual({ area: "tax", kind: "household_deduction", subject: "2026" });
    expect(parseFindingId("food:eating_out")).toEqual({ area: "food", kind: "eating_out", subject: null });
    for (const bad of ["", "food", "nope:rise", "food:Rise", "food:rise:", `food:rise:${"x".repeat(201)}`, "food:rise:a\nb"]) expect(parseFindingId(bad), bad).toBeNull();
  });
});

describe("optimise frame: inputs and facts", () => {
  it("treats a stale input as missing and asks for it with its old value", () => {
    const kmArea = area(
      (a) => {
        const km = valueOf(a.values, "car_km", a.today);
        return km === null ? [] : [{ ...draft({ mid: 30000 }), id: "car:summary", area: "car", kind: "summary", subject: null }];
      },
      (a) => [{ id: "car:summary", label: "Auton menot", status: valueOf(a.values, "car_km", a.today) === null ? "needs_input" : "clear", input: "car_km" }],
      "car",
    );
    const old = { value: 15000, asOf: addDays(TODAY, -366) };
    const stale = run(CTX12, kmArea, { values: { car_km: old } });
    expect(shown(stale)).toEqual([]);
    expect(stale.needed).toEqual([{ key: "car_km", def: "car_km", subject: null, areas: ["car"], old }]);
    const fresh = run(CTX12, kmArea, { values: { car_km: { value: 15000, asOf: addDays(TODAY, -10) } } });
    expect(ids(shown(fresh))).toEqual(["car:summary"]);
    expect(fresh.needed).toEqual([]);
  });

  it("lists each needed input once with every area that asks for it", () => {
    const one = area([draft({ needs: ["insurance_quote:s1", "not_an_input"] })], [{ id: "subscriptions:renewal", label: "Uusiutuvat sopimukset", status: "needs_input", input: "electricity_kwh" }]);
    const two = area([], [{ id: "electricity:price", label: "Sähkön hinta", status: "needs_input", input: "electricity_kwh" }], "electricity");
    const data = run(CTX12, [one, two]);
    expect(data.needed.map((n) => [n.key, n.areas])).toEqual([
      ["electricity_kwh", ["subscriptions", "electricity"]],
      ["insurance_quote:s1", ["subscriptions"]],
    ]);
  });

  const ROWS: Fact[] = [
    { id: "fee", label: "Maksu", value: 31100, unit: "snt", kind: "law", status: "valid", validFrom: "2025-08-01", validTo: "2026-07-31", asOf: "2025-08-01", expires: "2026-07-31", source: { title: "Laki", url: "https://example.fi/1" }, verifiedAt: "2026-10-11" },
    { id: "fee", label: "Maksu", value: 33500, unit: "snt", kind: "law", status: "valid", validFrom: "2026-08-01", asOf: "2026-08-01", expires: "2027-10-11", source: { title: "Laki", url: "https://example.fi/2" }, verifiedAt: "2026-10-11" },
    { id: "fee", label: "Maksu esityksen mukaan", value: 36000, unit: "snt", kind: "law", status: "proposed", validFrom: "2027-01-01", asOf: "2026-09-01", expires: "2027-10-11", source: { title: "Esitys", url: "https://example.fi/3" }, verifiedAt: "2026-10-11" },
    { id: "rate", label: "Korko", value: 2.1, unit: "%", kind: "rate", status: "valid", validFrom: "2026-01-01", asOf: "2026-03-31", expires: "2026-09-30", source: { title: "Pankki", url: "https://example.fi/4" }, verifiedAt: "2026-04-02" },
  ];
  const feeArea = area(
    (a) => {
      const fee = factFrom(ROWS, "fee", a.today);
      const rate = factFrom(ROWS, "rate", a.today);
      if (!fee || !rate) return [];
      const proposed = proposedFrom(ROWS, "fee", a.today);
      const mid = fee.value;
      return [
        draft({
          mid,
          facts: [fee.id],
          calc: [{ label: fee.label, value: formatEur(mid, false) }, ...(proposed ? [{ label: "Jos esitys hyväksytään", value: formatEur(proposed.value, false) }] : [])],
        }),
      ];
    },
    (a) => [{ id: "subscriptions:rise", label: "Maksu", status: factFrom(ROWS, "rate", a.today) ? "clear" : "no_data", hint: "Vertailutieto on vanhentunut." }],
  );

  it("hides a comparison whose fact expired and shows a proposed fact only as a calc line", () => {
    const expired = run(CTX12, feeArea);
    expect(shown(expired)).toEqual([]);
    expect(expired.areas[0]!.checks[0]!.status).toBe("no_data");
    const rateValid: Fact[] = ROWS.map((f) => (f.id === "rate" ? { ...f, asOf: "2026-08-31", expires: "2027-02-28" } : f));
    const fresh = area((a) => {
      const fee = factFrom(rateValid, "fee", a.today)!;
      const proposed = proposedFrom(rateValid, "fee", a.today);
      return [draft({ mid: fee.value, calc: [{ label: fee.label, value: formatEur(fee.value, false) }, { label: "Jos esitys hyväksytään", value: formatEur(proposed!.value, false) }] })];
    });
    const f = shown(run(CTX12, fresh))[0]!;
    expect(f.euros!.midCents).toBe(33500);
    expect(f.calc.map((c) => c.value)).toEqual([formatEur(33500, false), formatEur(36000, false)]);
    // the fee in force on a day before the change
    expect(factFrom(ROWS, "fee", "2026-07-15")!.value).toBe(31100);
  });

  it("drops a finding that cites a fact not valid today, and its check reads no_data", () => {
    const cites = (facts: string[]) => area(() => [draft({ mid: 30000, facts })], () => [{ id: "subscriptions:rise", label: "Maksu", status: "clear" }]);
    const gone = run(CTX12, cites(["no_such_fact"]));
    expect(shown(gone)).toEqual([]);
    expect(gone.areas[0]!.checks[0]!.status).toBe("no_data");
    expect(shown(run(CTX12, cites([]))).length).toBe(1);
  });

  it("validates input values as the server will", () => {
    const d = INPUT_DEFS;
    expect(parseInputValue(d.electricity_kwh, 10000, TODAY)).toEqual({ ok: true, value: 10000 });
    expect(parseInputValue(d.electricity_kwh, 499, TODAY).ok).toBe(false);
    expect(parseInputValue(d.electricity_kwh, 1000.5, TODAY).ok).toBe(false);
    expect(parseInputValue(d.electricity_kwh, "10000", TODAY).ok).toBe(false);
    expect(parseInputValue(d.insurance_quote, 1_000_000, TODAY)).toEqual({ ok: true, value: 1_000_000 });
    expect(parseInputValue(d.insurance_quote, 1_000_001, TODAY)).toEqual({ ok: false, error: "Anna summa väliltä 1–10\u00a0000 €." });
    expect(parseInputValue(d.electricity_contract_end, "2029-10-15", TODAY).ok).toBe(true);
    expect(parseInputValue(d.electricity_contract_end, "2029-10-16", TODAY).ok).toBe(false);
    expect(parseInputValue(d.electricity_contract_end, "2026-10-14", TODAY).ok).toBe(false);
    expect(parseInputValue(d.moved_on, "2026-02-30", TODAY).ok).toBe(false);
    expect(parseInputValue(d.moved_on, "2023-10-15", TODAY).ok).toBe(true);
    expect(parseInputValue(d.housing_type, "rivitalo", TODAY)).toEqual({ ok: true, value: "rivitalo" });
    expect(parseInputValue(d.housing_type, "linna", TODAY).ok).toBe(false);
    expect(parseInputValue(d.loan_rate, { marginBp: 85, reference: "euribor_12" }, TODAY)).toEqual({ ok: true, value: { marginBp: 85, reference: "euribor_12" } });
    expect(parseInputValue(d.loan_rate, { marginBp: 85, reference: "euribor_12", extra: 1 }, TODAY).ok).toBe(false);
    expect(parseInputValue(d.loan_rate, { marginBp: 501, reference: "fixed" }, TODAY)).toEqual({ ok: false, error: "Anna marginaali väliltä 0–5 % ja valitse viitekorko." });
    expect(inputDefOf("insurance_quote:abc")).toMatchObject({ def: { key: "insurance_quote" }, subject: "abc" });
    expect(inputDefOf("insurance_quote")).toBeNull();
    expect(inputDefOf("car_km:x")).toBeNull();
    expect(inputDefOf("nope")).toBeNull();
    // the subject becomes part of a stored key: bounded, no control characters
    expect(inputDefOf(`insurance_quote:${"x".repeat(201)}`)).toBeNull();
    expect(inputDefOf("insurance_quote:a\nb")).toBeNull();
  });

  it("counts a date input stale once its date has passed", () => {
    const values = { electricity_contract_end: { value: "2026-10-14", asOf: "2026-01-01" }, moved_on: { value: "2020-01-01", asOf: "2020-01-02" } };
    expect(valueOf(values, "electricity_contract_end", TODAY)).toBeNull();
    expect(valueOf(values, "electricity_contract_end", "2026-10-14")).toBe("2026-10-14");
    expect(valueOf(values, "moved_on", TODAY)).toBe("2020-01-01");
  });
});

describe("optimise frame: evidence and common helpers", () => {
  it("steps down when the evidence account has a gap or the rows were categorised by default", () => {
    const card: Transaction[] = [];
    for (let d = "2026-01-02"; d <= "2026-09-28"; d = addDays(d, 3)) if (d < "2026-05-01" || d > "2026-05-25") card.push(tx({ bookingDate: d, accountId: "card", amountCents: -2000, merchant: "Lidl", mcc: "5411" }));
    const ctx = ctxWith(12, [...card, tx({ bookingDate: "2026-09-10", amountCents: -4000, merchant: "Xyzzy Tuntematon" })]);
    const cardRows = ctx.txs.filter((t) => t.accountId === "card").slice(-5).map((t) => t.id);
    const unknownRow = ctx.txs.filter((t) => t.merchant === "Xyzzy Tuntematon" && t.categorySource === "default").map((t) => t.id);
    expect(unknownRow).toHaveLength(1);
    const data = run(ctx, area([draft({ subject: "Kortti", rows: cardRows }), draft({ subject: "Tuntematon", rows: unknownRow })]));
    const by = (s: string) => shown(data).find((f) => f.subject === s)!;
    expect(by("Kortti").certainty).toEqual({ level: "keskitaso", reason: "Tilin Luottokortti tiedoissa on tauko." });
    expect(by("Tuntematon").weaknesses.map((w) => w.id)).toEqual(["uncertain_rows"]);
    // over 5 % of the window's spending uncategorised lowers every finding with rows
    const messy = ctxWith(12, [tx({ bookingDate: "2026-09-10", amountCents: -40000, merchant: "Xyzzy Tuntematon" })]);
    const groceries = messy.txs.filter((t) => t.merchant === "K-Market Kamppi").slice(-3).map((t) => t.id);
    const f = shown(run(messy, area([draft({ rows: groceries }), draft({ subject: "Ilman", rows: [] })])));
    expect(f.map((x) => [x.subject, x.weaknesses.map((w) => w.reason)])).toEqual([
      ["Ilman", []],
      ["Elisa", ["12\u00a0% menoista on luokittelematta."]],
    ]);
  });

  it("caps the rows at 60 and keeps struck rows among them", () => {
    const rows = CTX12.txs.slice(0, 70).map((t) => t.id);
    const f = shown(run(CTX12, area([{ ...draft(), rows, struck: [rows[0]!, rows[69]!] }])))[0]!;
    expect(f.rows).toEqual(rows.slice(-60));
    expect(f.struck).toEqual([rows[69]]);
  });

  it("leaves out an account whose first row falls inside the window", () => {
    const ctx = ctxWith(12, [tx({ bookingDate: "2026-03-04", accountId: "card", amountCents: -1000, merchant: "Lidl" })]);
    expect([...accountsBefore(ctx, "2025-10-01")]).toEqual(["acc-1"]);
    expect([...accountsBefore(ctx, "2026-03-01")].sort()).toEqual(["acc-1", "card"]);
  });

  it("strikes a row over three times its merchant's median and counts the rest per month", () => {
    const ctx = ctxWith(3, [tx({ bookingDate: "2026-08-20", amountCents: -60000, merchant: "K-Market Kamppi", mcc: "5411" })]);
    const months = ["2026-07", "2026-08", "2026-09"];
    const level = levelWithoutOneOffs(ctx.txs.filter((t) => t.merchant === "K-Market Kamppi"), months);
    expect(level.byMonth).toEqual([25000, 25000, 25000]);
    expect(level.struck).toEqual(ctx.txs.filter((t) => t.amountCents === -60000).map((t) => t.id));
  });

  it("reads the numbers of a Finnish text as written", () => {
    expect(numbersIn("Elisa: hinta nousi 19,90 € → 34,90 € 12.3.2026. Nousu on 1\u00a0180 € vuodessa, 12 % ja \u22125.")).toEqual(["19,90", "34,90", "12.3.2026", "1 180", "12", "\u22125"]);
  });
});

describe("optimise frame: Tilanne", () => {
  it("gives the four facts against the household's own months", () => {
    const data = buildOptimise({
      ctx: CTX12,
      balances: [{ id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: 75000, ownerName: null, balanceAt: TODAY }],
      areas: [],
    });
    expect(data.situation.map((s) => [s.id, s.text])).toEqual([
      ["savings_rate", "0\u00a0%"],
      ["fixed_share", "0\u00a0%"],
      ["buffer", "3,0 kuukautta"],
      ["debt_share", "0\u00a0%"],
    ]);
    expect(data.situation[2]!.basis).toBe(`Tilien saldot ${formatEur(75000, false)} ja tavalliset menot ${formatEur(25000, false)} kuussa.`);
    expect(data).toMatchObject({ months: 12, historyMonths: 12, accounts: 2, dataTo: TODAY, end: "2026-09-30" });
  });
});
