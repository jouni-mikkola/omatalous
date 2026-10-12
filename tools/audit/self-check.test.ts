import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/** The script as the page gets it: one expression that ends in a promise of a string. */
const SCRIPT = readFileSync(new URL("./self-check.js", import.meta.url), "utf8");

type Json = Record<string, any>;
type Row = { id: string; accountId: string; bookingDate: string; amountCents: number; counterparty: string | null; merchant: string; category: string; isTransfer: boolean; status: string; partCents?: number };

const KINDS: Record<string, string> = { salary: "income", investment_income: "income", p2p_in: "income", housing: "expense", groceries: "expense", p2p: "expense", gambling: "expense", other: "expense", mortgage: "debt", savings: "savings", transfer: "transfer" };
const CATEGORIES = Object.entries(KINDS).map(([id, kind]) => ({ id, kind, label: id, group: id }));
const TODAY = "2026-10-12";
const MONTHS = Array.from({ length: 13 }, (_, i) => {
  const k = 2026 * 12 + 9 - 12 + i;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
});

/** A household in which every figure agrees: a checking and a savings account, thirteen months of rows every ten days or so. */
function household() {
  const rows: Row[] = [];
  let n = 0;
  const add = (accountId: string, day: string, amountCents: number, category: string, merchant: string, isTransfer = false) => {
    if (day <= TODAY) rows.push({ id: `r${++n}`, accountId, bookingDate: day, amountCents, counterparty: merchant, merchant, category, isTransfer, status: "booked" });
  };
  for (const m of MONTHS) {
    add("a1", `${m}-01`, 300000, "salary", "ESIMERKKI OY");
    add("a1", `${m}-03`, -90000, "housing", "VUOKRANANTAJA OY");
    add("a1", `${m}-05`, -10000, "transfer", "OMA SIIRTO", true);
    add("a2", `${m}-05`, 10000, "transfer", "OMA SIIRTO", true);
    add("a1", `${m}-08`, -4100, "groceries", "KAUPPA OY");
    add("a1", `${m}-18`, -3900, "groceries", "KAUPPA OY");
    add("a1", `${m}-28`, -4200, "groceries", "KAUPPA OY");
    add("a2", `${m}, 15`.replace(", ", "-"), 120, "investment_income", "PANKKI OY");
    add("a2", `${m}-25`, 110, "investment_income", "PANKKI OY");
  }
  const meta: Json = {
    today: TODAY,
    version: { app: "0.12.0" },
    user: { displayName: "Matti Meikalainen" },
    members: [{ id: "u1", displayName: "Matti Meikalainen" }],
    categories: CATEGORIES,
    accounts: [
      { id: "a1", name: "Matin palkkatili", iban: "FI0012345600000785", type: "checking", balanceCents: 500000, use: { users: [{ userId: "u1", weight: 1 }] } },
      { id: "a2", name: "Matin sijoitustili", iban: "FI0012345600000793", type: "savings", balanceCents: 130000, use: { users: [{ userId: "u1", weight: 1 }] } },
    ],
    sharedAccounts: [],
  };
  return { rows, meta, loans: [] as Json[], proposals: [] as Json[], series: [] as Json[], cards: [] as Json[] };
}
type Household = ReturnType<typeof household>;

const cut = (h: Household, from: string, to: string, f: Json = {}) =>
  h.rows.filter((r) => r.bookingDate >= from && r.bookingDate <= to && (!f.accountId || r.accountId === f.accountId) && (!f.category || r.category === f.category));
const typeOf = (h: Household, id: string) => h.meta.accounts.find((a: Json) => a.id === id)?.type;
const amount = (r: Row) => r.partCents ?? r.amountCents;

/** The totals of a range the way the app counts them, written out once more for the test. */
function totals(h: Household, from: string, to: string) {
  const t = { incomeCents: 0, consumptionCents: 0, debtCents: 0, savedCents: 0, borrowedCents: 0 };
  const spend = new Map<string, number>();
  for (const r of cut(h, from, to)) {
    const kind = KINDS[r.category];
    const a = amount(r);
    if (typeOf(h, r.accountId) === "loan") continue;
    if (r.isTransfer) t.savedCents += typeOf(h, r.accountId) === "savings" ? a : 0;
    else if (kind === "expense") t.consumptionCents -= a;
    else if (kind === "debt") t.debtCents -= a;
    else if (kind === "savings") t.savedCents -= a;
    else if (kind === "income") t.incomeCents += a;
    if (!r.isTransfer && (kind === "expense" || kind === "debt")) spend.set(r.category, (spend.get(r.category) ?? 0) - a);
  }
  const expenseCents = t.consumptionCents + t.debtCents;
  return { ...t, expenseCents, netCents: t.incomeCents - expenseCents, leftCents: t.incomeCents - expenseCents - t.savedCents, spend };
}

function answer(h: Household, url: URL): Json {
  const p = url.pathname;
  const from = url.searchParams.get("from") ?? "2000-01-01";
  const to = url.searchParams.get("to") ?? TODAY;
  if (p === "/api/meta") return h.meta;
  if (p === "/api/transactions") {
    const f = { accountId: url.searchParams.get("accountId"), category: url.searchParams.get("category") };
    const rs = cut(h, from, to, f).sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : -1));
    const live = rs.filter((r) => !r.isTransfer);
    const off = Number(url.searchParams.get("offset") ?? 0);
    return {
      total: rs.length,
      inCents: live.filter((r) => amount(r) > 0).reduce((s, r) => s + amount(r), 0),
      outCents: -live.filter((r) => amount(r) < 0).reduce((s, r) => s + amount(r), 0),
      items: rs.slice(off, off + Number(url.searchParams.get("limit") ?? 100)),
    };
  }
  if (p === "/api/dashboard" || p === "/api/reports") {
    const t = totals(h, from, to);
    const categories = [...t.spend].filter(([, c]) => c > 0).map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents);
    const total = categories.reduce((s, c) => s + c.cents, 0);
    const holdings = { accountsCents: 630000, accounts: [{ id: "a1", balanceCents: 500000 }, { id: "a2", balanceCents: 130000 }], cards: h.cards };
    if (p === "/api/dashboard") return { totals: t, categories, pace: { current: [0, 100, 300, null], previous: { curve: [0, 50] } }, holdings };
    const month = from.slice(0, 7);
    return {
      summary: { incomeCents: t.incomeCents, spendingCents: t.expenseCents, savedCents: t.savedCents, netCents: t.netCents },
      cashflow: { totals: t, rows: [{ month, ...t }] },
      categories: { totalCents: total, incomeCents: t.incomeCents, groups: [{ totalCents: total, categories: categories.map((c) => ({ category: c.category, totalCents: c.cents })) }] },
      pivot: { totalCents: total, rows: categories.map((c) => ({ totalCents: c.cents })), monthTotals: [total] },
      fixedVariable: { totals: { fixedCents: 0, habitCents: 0, variableCents: t.consumptionCents, debtCents: t.debtCents } },
      income: { months: to < TODAY ? [{ month, totalCents: t.incomeCents }] : [] },
      balances: { accounts: [{ accountId: "a1", values: [1, 500000] }, { accountId: "a2", values: [1, 130000] }], holdings },
    };
  }
  if (p === "/api/recurring") return { series: h.series, marks: [] };
  if (p === "/api/loans") return { loans: h.loans };
  if (p === "/api/loans/proposals") return { proposals: h.proposals };
  if (p === "/api/merchants") {
    const out = new Map<string, number>();
    for (const r of cut(h, from, to).filter((x) => !x.isTransfer && amount(x) < 0)) out.set(r.merchant, (out.get(r.merchant) ?? 0) - amount(r));
    return { items: [...out].map(([merchant, totalCents]) => ({ merchant, totalCents })) };
  }
  throw new Error(`no made-up answer for ${p}`);
}

type Patch = Record<string, (a: Json, url: URL) => Json | null>;
type Stats = { calls: string[]; inFlight: number; most: number };

/** Runs the script in a bare context whose fetch answers from the household, one patch per path changing the answer. */
async function run(h: Household, patch: Patch = {}, stats: Stats = { calls: [], inFlight: 0, most: 0 }) {
  const fetch = async (path: string) => {
    const url = new URL(path, "http://localhost");
    stats.calls.push(url.pathname);
    stats.most = Math.max(stats.most, ++stats.inFlight);
    await Promise.resolve();
    stats.inFlight--;
    const a = answer(h, url);
    const changed = patch[url.pathname] ? patch[url.pathname]!(structuredClone(a), url) : a;
    if (changed === null) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => changed };
  };
  const text: string = await runInNewContext(SCRIPT, { fetch });
  return { text, out: JSON.parse(text) as Json, stats };
}
const codes = (out: Json) => (out.failures as Json[]).map((f) => f.code);
const found = (out: Json, code: string) => (out.failures as Json[]).filter((f) => f.code === code);
/** The line of a code at one place: the lines come most money first, so the first of a code may be another month's. */
const at = (out: Json, code: string, where: string) => found(out, code).find((f) => f.where === where);

describe("a household whose figures agree", () => {
  it("reports no failure and reads the answers one at a time, within the request limit", async () => {
    const { out, stats } = await run(household());
    expect(out.failures).toEqual([]);
    expect(stats.most).toBe(1);
    expect(stats.calls.length).toBeLessThanOrEqual(40);
    expect(Object.keys(out.checks)).toEqual(expect.arrayContaining(["1", "2", "3", "4", "5", "7", "8"]));
  });

  it("pages through the rows", async () => {
    const h = household();
    const { out, stats } = await run(h, { "/api/transactions": (a, url) => (url.searchParams.has("accountId") ? a : { ...a, items: a.items.slice(0, 40) }) });
    expect(stats.calls.filter((c) => c === "/api/transactions").length).toBeGreaterThan(1);
    expect(out.checks.all ?? "").not.toMatch(/limit/);
  });
});

describe("check 1: the front page", () => {
  it("reports a negative category with its id", async () => {
    const { out } = await run(household(), { "/api/dashboard": (a, url) => (url.searchParams.get("scope") === "own" ? { ...a, categories: [...a.categories, { category: "p2p", cents: -2500 }] } : a) });
    const f = found(out, "1.neg");
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]).toMatchObject({ where: expect.stringContaining("dashboard own 2026-"), got: "p2p -2500" });
  });

  it("reports category rows that do not add up to the spending total, and a cumulative line below zero", async () => {
    const { out } = await run(household(), { "/api/dashboard": (a) => ({ ...a, categories: a.categories.slice(1), pace: { current: [0, -300, null], previous: { curve: [0, -5] } } }) });
    expect(at(out, "1.sum", "dashboard own 2026-09")).toMatchObject({ expected: expect.stringContaining("spending total") });
    expect(found(out, "1.cumulative")[0]!.got).toContain("1 days below 0, the lowest -300, first on day 2");
  });

  it("reports an income total that differs from the income report", async () => {
    const { out } = await run(household(), { "/api/reports": (a) => (a.income.months.length ? { ...a, income: { months: [{ month: a.income.months[0].month, totalCents: 290000 }] } } : a) });
    expect(at(out, "1.income", "dashboard own 2026-09")).toMatchObject({ expected: "300230", got: "290000" });
  });

  it("reports a dashboard that differs from the rows, by category", async () => {
    const { out } = await run(household(), { "/api/dashboard": (a) => ({ ...a, categories: a.categories.map((c: Json) => (c.category === "groceries" ? { ...c, cents: c.cents + 700 } : c)), totals: { ...a.totals, consumptionCents: a.totals.consumptionCents + 700, expenseCents: a.totals.expenseCents + 700 } }) });
    expect(at(out, "1.rows-consumption", "dashboard own 2026-09")).toMatchObject({ expected: "102200", got: "102900" });
    expect(found(out, "1.rows-category")[0]!.where).toContain("category groceries");
  });
});

describe("check 2: month by month", () => {
  it("reports own transfers that do not match, the uncategorised share, incoming rows in a spending category and outgoing in an income category", async () => {
    const h = household();
    h.rows.find((r) => r.bookingDate === "2026-03-05" && r.accountId === "a2")!.amountCents = 9000;
    for (const r of h.rows.filter((x) => x.bookingDate.startsWith("2026-04") && KINDS[x.category] === "expense")) r.category = "other";
    h.rows.push({ id: "x1", accountId: "a1", bookingDate: "2026-05-10", amountCents: 8000, counterparty: "X", merchant: "X", category: "groceries", isTransfer: false, status: "booked" });
    h.rows.push({ id: "x2", accountId: "a1", bookingDate: "2026-06-10", amountCents: -200000, counterparty: "Y", merchant: "Y", category: "salary", isTransfer: false, status: "booked" });
    const { out } = await run(h);
    expect(found(out, "2.transfers")[0]).toMatchObject({ where: "2026-03", got: expect.stringContaining("in 1 rows 9000, out 1 rows 10000") });
    expect(found(out, "2.uncategorised")[0]).toMatchObject({ where: "2026-04", got: "100 % (102200 of 102200)" });
    expect(found(out, "2.incoming-in-spending")[0]).toMatchObject({ where: "2026-05 category groceries", got: "1 rows, 8000" });
    expect(found(out, "2.outgoing-in-income")[0]).toMatchObject({ where: "2026-06 category salary", got: "1 rows, 200000" });
  });
});

describe("check 3: the accounts", () => {
  it("reports a gap, an account without a recent row and a history that starts late", async () => {
    const h = household();
    h.rows = h.rows.filter((r) => !(r.accountId === "a2" && r.bookingDate >= "2026-07-01" && r.bookingDate <= "2026-08-20") && !(r.accountId === "a2" && r.bookingDate < "2026-02-01"));
    const { out } = await run(h);
    expect(found(out, "3.gap")[0]).toMatchObject({ where: "account 2 (savings)" });
    expect(found(out, "3.short-history")[0]).toMatchObject({ where: "account 2 (savings)", got: expect.stringContaining("first row 2026-02") });
    h.rows = h.rows.filter((r) => !(r.accountId === "a2" && r.bookingDate > "2026-08-20"));
    expect(found((await run(h)).out, "3.stale")[0]).toMatchObject({ where: "account 2 (savings)" });
  });
});

describe("check 4: the same row twice", () => {
  it("reports identical rows under different ids and passes a near miss", async () => {
    const h = household();
    const same = h.rows.find((r) => r.category === "groceries")!;
    h.rows.push({ ...same, id: "dup1" });
    h.rows.push({ ...same, id: "near", amountCents: same.amountCents - 1 });
    const f = found((await run(h)).out, "4.duplicate");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ where: "account 1 (checking)", got: expect.stringContaining("1 groups, 1 extra rows, 4100 in the extra rows") });
  });
});

describe("check 5: recurring series and lenders", () => {
  const series = (extra: Json): Json => ({ id: "out:a1:VUOKRANANTAJA OY", merchant: "VUOKRANANTAJA OY", category: "housing", kind: "subscription", cadence: "monthly", intervalDays: 30.44, active: true, overdue: false, firstDate: "2025-10-03", lastDate: "2026-10-03", nextDate: "2026-11-03", typicalAmountCents: 90000, ...extra });

  it("reports a next day in the past, a next day by interval for a varying day of the month, varying amounts and a lender", async () => {
    const h = household();
    for (const r of h.rows.filter((x) => x.category === "housing")) r.bookingDate = `${r.bookingDate.slice(0, 7)}-${String(1 + (Number(r.bookingDate.slice(5, 7)) % 4) * 4).padStart(2, "0")}`;
    h.rows.filter((x) => x.category === "housing").forEach((r, i) => (r.amountCents = i % 2 ? -90000 : -60000));
    h.series = [series({ nextDate: "2026-10-01", overdue: true, lastDate: "2026-09-04" }), series({ id: "out:a1:VUOKRANANTAJA OY#habit", kind: "habit", nextDate: "2026-09-01" })];
    h.proposals = [{ key: "out:a1:PANKKI OY", payee: "PANKKI OY", paymentCents: 28900, months: 14, kind: "car" }];
    const { out } = await run(h);
    expect(found(out, "5.next-past")).toHaveLength(2);
    expect(found(out, "5.next-past")[0]).toMatchObject({ where: "payee #1 (company), subscription, account 1 (checking)", got: expect.stringContaining("marked overdue") });
    expect(found(out, "5.amounts")[0]!.got).toContain("60000 to 90000");
    expect(found(out, "5.lender")[0]).toMatchObject({ where: "payee #2 (company)", got: "proposed as a car loan: 14 months, payment 28900" });
    h.series = [series({ lastDate: "2026-10-03", nextDate: "2026-11-02" })];
    expect(found((await run(h)).out, "5.next-by-interval")[0]!.got).toContain("varies by");
  });

  it("passes a series with its next day ahead and amounts within a fifth", async () => {
    const h = household();
    h.series = [series({})];
    expect(codes((await run(h)).out).filter((c) => c.startsWith("5."))).toEqual([]);
  });
});

describe("check 6: a joint account", () => {
  it("reports sums that do not follow the part, and payments to persons and to gambling", async () => {
    const h = household();
    h.meta.accounts.push({ id: "a3", name: "Yhteinen tili", iban: "FI0012345600000801", type: "checking", balanceCents: 1, part: { from: 0, to: 1, of: 2 }, use: { users: [{ userId: "u1", weight: 1 }, { userId: "u2", weight: 1 }] } });
    for (const [i, c] of ["groceries", "gambling", "p2p"].entries()) {
      for (const d of ["10", "20"]) h.rows.push({ id: `j${i}${d}`, accountId: "a3", bookingDate: `2026-09-${d}`, amountCents: -10000, counterparty: "SEKA", merchant: "SEKA", category: c, isTransfer: false, status: "booked", partCents: c === "groceries" ? -7000 : -5000 });
    }
    const { out } = await run(h);
    expect(found(out, "6.part")[0]).toMatchObject({ where: "account 3 (checking, joint) category groceries", expected: "50 % of -20000 = -10000", got: "-14000 over 2 rows" });
    expect(found(out, "6.sensitive").map((f) => f.got)).toEqual(expect.arrayContaining(["gambling: 2 rows, whole 20000, at the viewer's part 10000", "p2p: 2 rows, whole 20000, at the viewer's part 10000"]));
    expect(found(out, "6.part")).toHaveLength(1);
  });
});

describe("check 7: the reports", () => {
  it("reports a report total that differs from the front page, the rows or the transactions list", async () => {
    const patch: Patch = {
      "/api/reports": (a) => ({ ...a, summary: { ...a.summary, spendingCents: a.summary.spendingCents + 5 }, pivot: { ...a.pivot, monthTotals: [a.pivot.totalCents + 9] } }),
      "/api/transactions": (a, url) => (url.searchParams.get("category") === "groceries" ? { ...a, outCents: a.outCents + 300 } : a),
    };
    const { out } = await run(household(), patch);
    expect(at(out, "7.summary", "reports own 2026-09 spendingCents")).toMatchObject({ expected: "102200", got: "102205" });
    expect(at(out, "7.pivot-months", "reports own 2026-09")).toBeDefined();
    expect(found(out, "7.transactions")[0]).toMatchObject({ where: "own 2026-09 category groceries", expected: "12200", got: "12500" });
  });
});

describe("check 8: what the household holds", () => {
  it("reports sums that differ, a card without a limit and an account typed other or loan", async () => {
    const h = household();
    h.meta.accounts.push({ id: "a4", name: "Kortti", type: "credit_card", balanceCents: -4000, creditLimitCents: null }, { id: "a5", name: "Muu tili", type: "other", balanceCents: 10 });
    const { out } = await run(h, { "/api/dashboard": (a) => ({ ...a, holdings: { ...a.holdings, accountsCents: a.holdings.accountsCents + 1 } }) });
    expect(found(out, "8.accounts-sum")[0]).toMatchObject({ where: "holdings", expected: "630000", got: "630001" });
    expect(found(out, "8.card-limit")[0]).toMatchObject({ where: "account 3 (credit_card)", got: "none, balance -4000" });
    expect(found(out, "8.type")[0]).toMatchObject({ where: "account 4 (other)" });
    h.meta.accounts[2].creditLimitCents = 300000;
    expect(found((await run(h)).out, "8.card-limit")).toEqual([]);
  });
});

describe("an instance that answers less", () => {
  it("does not throw on empty answers, on errors or on an older shape, and says what it did not check", async () => {
    const h = household();
    const empty = await run(h, Object.fromEntries(["/api/meta", "/api/dashboard", "/api/reports", "/api/recurring", "/api/loans", "/api/loans/proposals", "/api/merchants", "/api/transactions"].map((p) => [p, () => ({})])));
    expect(Object.values(empty.out.checks).join(" ")).toContain("not checked");
    const errors = await run(h, Object.fromEntries(["/api/meta", "/api/dashboard", "/api/reports", "/api/recurring", "/api/loans/proposals", "/api/merchants"].map((p) => [p, () => null])));
    expect(errors.out.checks.all).toContain("answered 500");
    const older = await run(h, { "/api/dashboard": (a) => ({ totals: a.totals, categories: a.categories }), "/api/reports": (a) => ({ summary: a.summary }) });
    expect(Object.values(older.out.checks).join(" ")).toContain("not checked");
  });
});

describe("what the answer holds", () => {
  const NAMES = ["Matti Meikalainen", "Elisa Esimerkki", "ESIMERKKI OY", "FI0012345600000785", "Matin palkkatili", "OSTOSPAIKKA KY", "Vuokranantaja Heikki", "viitenumero 1234 5678", "Pankkikortti Visa"] as const;

  it("never holds a name, an IBAN, a description or a counterparty of the input, whatever fails", async () => {
    const h = household();
    h.meta.user = { displayName: NAMES[0], username: "matti.meikalainen" };
    h.meta.members = [{ id: "u1", displayName: NAMES[0] }, { id: "u2", displayName: NAMES[1] }];
    h.meta.accounts[0] = { ...h.meta.accounts[0], name: NAMES[4], iban: NAMES[3], holder: `${NAMES[0]};${NAMES[1]}`, bank: "Esimerkkipankki", cardMask: "•••• 1234", creditLimitCents: null, part: { from: 0, to: 1, of: 2 }, use: { users: [{ userId: "u1", weight: 1, label: NAMES[0] }, { userId: "u2", weight: 1, label: NAMES[1] }] } };
    h.meta.accounts.push({ id: "a4", name: NAMES[8], type: "credit_card", balanceCents: -100, iban: null });
    // every kind of failure at once, each carrying names in the free-text fields
    for (const r of h.rows.filter((x) => x.accountId === "a1")) Object.assign(r, { counterparty: NAMES[5], merchant: NAMES[5], description: `${NAMES[7]} ${NAMES[2]}`, counterpartyIban: NAMES[3], partCents: Math.round(r.amountCents / 2) });
    h.rows.push({ id: "p1", accountId: "a1", bookingDate: "2026-09-02", amountCents: -9900, counterparty: NAMES[6], merchant: NAMES[6], category: "p2p", isTransfer: false, status: "booked", partCents: -4950 });
    h.rows.push({ id: "p2", accountId: "a1", bookingDate: "2026-09-02", amountCents: -9900, counterparty: NAMES[6], merchant: NAMES[6], category: "p2p", isTransfer: false, status: "booked", partCents: -4950 });
    h.rows.push({ id: "d1", accountId: "a1", bookingDate: "2026-09-12", amountCents: 9000, counterparty: NAMES[1], merchant: NAMES[1], category: "groceries", isTransfer: false, status: "booked" });
    h.series = [{ id: `out:a1:${NAMES[6]}`, merchant: NAMES[6], category: "p2p", kind: "subscription", cadence: "monthly", intervalDays: 30, active: true, overdue: false, lastDate: "2026-08-02", nextDate: "2026-09-02", typicalAmountCents: 9900 }];
    h.proposals = [{ key: `out:a1:${NAMES[2]}`, payee: NAMES[2], paymentCents: 5000, months: 12, kind: "car" }];
    const { text, out } = await run(h, { "/api/dashboard": (a) => ({ ...a, categories: [...a.categories, { category: NAMES[6], cents: -5, label: NAMES[6] }] }) });
    expect(out.failures.length).toBeGreaterThan(5);
    for (const name of NAMES) expect(text.toLowerCase(), name).not.toContain(name.toLowerCase());
    expect(text).not.toContain("Esimerkkipankki");
    expect(text).toContain("unknown-category");
    expect(text).toMatch(/payee #\d+ \((person|company)\)/);
  });

  it("is at most 6 000 characters with at most forty failures, the most money first", async () => {
    const h = household();
    for (let i = 0; i < 90; i++) h.rows.push({ id: `big${i}`, accountId: "a1", bookingDate: `2026-0${1 + (i % 9)}-1${i % 9}`, amountCents: 1000 + i, counterparty: `Kauppa ${i}`, merchant: `Kauppa ${i}`, category: "groceries", isTransfer: false, status: "booked" });
    h.rows.push(...h.rows.slice(0, 600).map((r, i) => ({ ...r, id: `copy${i}` })));
    const { text, out } = await run(h, { "/api/dashboard": (a) => ({ ...a, categories: [...a.categories, ...Array.from({ length: 30 }, (_, i) => ({ category: "p2p", cents: -(i + 1) }))] }) });
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(out.failures.length).toBeLessThanOrEqual(40);
    expect(out.more).toBeGreaterThan(0);
  });
});
