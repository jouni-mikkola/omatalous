import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import { earnedIncome, usualIncome } from "../src/analysis/usual.ts";
import { enrichIsland, enrichTransactions } from "../src/pipeline.ts";
import { applyPayerRoles, PAYER_ROLES, payerKeyOf, payerRoleOf } from "../src/payer-role.ts";
import { type Account, type CategoryRule, NO_INPUTS, type PayerRole, type PayerRoleRow, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const eur = (euros: number) => Math.round(euros * 100);
const VILLE_IBAN = "FI2112345600000785";
const holder = "Matti Meikalainen";
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI0000000000000001", currency: "EUR", type: "checking", holder };
const today = "2026-11-09";

const member = (userId: string, counterpartyKey: string, role: PayerRole): PayerRoleRow => ({ scope: "member", userId, counterpartyKey, role });
const household = (counterpartyKey: string, role: PayerRole): PayerRoleRow => ({ scope: "household", userId: null, counterpartyKey, role });
const VILLE = `iban:${VILLE_IBAN}`;

/** Money from Ville Esimerkki by MobilePay: a person, today read as money from people. */
const fromVille = (euros: number, date: string, over: Partial<Transaction> = {}) =>
  tx({ bookingDate: date, amountCents: eur(euros), merchant: "Ville Esimerkki", counterparty: "Ville Esimerkki", counterpartyIban: VILLE_IBAN, description: "MobilePay", reference: null, ...over });
const villeRows = () => [fromVille(300, "2026-08-03"), fromVille(300, "2026-09-03"), fromVille(300, "2026-10-03")];
/** A purchase before the history of the payer, so August counts as a whole month. */
const anchor = () => tx({ bookingDate: "2026-07-31", amountCents: -eur(10), merchant: "Prisma", category: "groceries", categorySource: "rule" });

const run = (rows: Transaction[], roles: PayerRoleRow[], memberId = "1", accounts: Account[] = [checking]) =>
  enrichTransactions(rows, accounts, [], new Map(), { memberId, roles });
/** The rows as the run leaves them: enrichTransactions returns only the changed ones. */
const settled = (rows: Transaction[], roles: PayerRoleRow[], memberId = "1", accounts: Account[] = [checking]) => {
  const changed = new Map(run(rows, roles, memberId, accounts).map((t) => [t.id, t]));
  return rows.map((t) => changed.get(t.id) ?? t);
};
const ctxOf = (rows: Transaction[], accounts: Account[] = [checking]) => createContext(rows, accounts, today);

describe("the payer of a row", () => {
  it("is its IBAN, normalised, else the distinct folded words of the counterparty, sorted", () => {
    expect(payerKeyOf({ counterpartyIban: "fi21 1234 5600 0007 85", counterparty: "Ville Esimerkki" })).toBe(VILLE);
    expect(payerKeyOf({ counterpartyIban: null, counterparty: "Esimerkki, Ville Ville" })).toBe("name:ESIMERKKI VILLE");
    expect(payerKeyOf({ counterpartyIban: null, counterparty: "Ville Esimerkki" })).toBe(payerKeyOf({ counterpartyIban: null, counterparty: "ESIMERKKI VILLE" }));
  });

  it("is none for a row with neither: its description alone is never a payer", () => {
    expect(payerKeyOf({ counterpartyIban: null, counterparty: null })).toBeNull();
    expect(payerKeyOf({ counterpartyIban: "  ", counterparty: "" })).toBeNull();
    expect(payerRoleOf([household("name:ESIMERKKI VILLE", "gift")], tx({ bookingDate: "2026-10-03", amountCents: 100, description: "Ville Esimerkki" }), "1")).toBeNull();
  });
});

describe("which answer reaches a row", () => {
  const row = (counterparty: string | null, iban: string | null = null, euros = 300) => tx({ bookingDate: "2026-10-03", amountCents: eur(euros), counterparty, counterpartyIban: iban });
  const roleOf = (roles: PayerRoleRow[], t: Transaction, memberId = "1") => payerRoleOf(roles, t, memberId);

  it("keeps the role when the name is written the other way round", () => {
    const roles = [member("1", "name:ESIMERKKI VILLE", "gift")];
    expect(roleOf(roles, row("Ville Esimerkki"))).toBe("gift");
    expect(roleOf(roles, row("Esimerkki Ville"))).toBe("gift");
    expect(roleOf(roles, row("Esimerkki Ville Matias"))).toBe("gift");
  });

  it("lets the IBAN decide whatever the name says, and a name answer reach an IBAN row that has no IBAN answer", () => {
    const both = [member("1", VILLE, "sales"), member("1", "name:ESIMERKKI VILLE", "gift")];
    expect(roleOf(both, row("Ville Esimerkki", VILLE_IBAN))).toBe("sales");
    expect(roleOf(both, row("Joku Toinen", VILLE_IBAN))).toBe("sales");
    expect(roleOf(both, row("Ville Esimerkki", "FI0000000000000099"))).toBe("gift");
    expect(roleOf([member("1", VILLE, "sales")], row("Ville Esimerkki"))).toBeNull();
  });

  it("matches no initials and no company that shares the person's words", () => {
    const roles = [member("1", "name:ESIMERKKI VILLE", "gift")];
    expect(roleOf(roles, row("Ville E."))).toBeNull();
    expect(roleOf(roles, row("Ville"))).toBeNull();
    const matti = [member("1", "name:MEIKALAINEN MATTI", "own_money")];
    expect(roleOf(matti, row("Matti Meikalainen Kiinteistot Oy"))).toBeNull();
    expect(roleOf(matti, row("Matti Meikalainen"))).toBe("own_money");
    // the other way: the answer is about the company, the row about the person
    expect(roleOf([member("1", "name:KIINTEISTOT MATTI MEIKALAINEN OY", "sales")], row("Matti Meikalainen"))).toBeNull();
    expect(roleOf([member("1", "name:KIINTEISTOT MATTI MEIKALAINEN OY", "sales")], row("Kiinteistot Matti Meikalainen Oy"))).toBe("sales");
  });

  it("gives no role when two answers of one scope say different things about the row", () => {
    const two = [member("1", "name:ESIMERKKI VILLE", "cost_share"), member("1", "name:ESIMERKKI MATIAS VILLE", "gift")];
    expect(roleOf(two, row("Ville Matias Esimerkki"))).toBeNull();
    // the household default does not step in for the member's two
    expect(roleOf([...two, household("name:ESIMERKKI MATIAS VILLE", "sales")], row("Ville Matias Esimerkki"))).toBeNull();
    // "Ville Esimerkki" is one person with "Ville Matias Esimerkki": both answers reach it
    expect(roleOf(two, row("Ville Esimerkki"))).toBeNull();
    expect(roleOf([two[0]!], row("Ville Matias Esimerkki"))).toBe("cost_share");
  });

  it("takes the member's own answer over the household default, and each member sees only their own and the default", () => {
    const roles = [member("2", "name:ESIMERKKI VILLE", "gift"), household("name:ESIMERKKI VILLE", "cost_share")];
    expect(roleOf(roles, row("Ville Esimerkki"), "1")).toBe("cost_share");
    expect(roleOf(roles, row("Ville Esimerkki"), "2")).toBe("gift");
    expect(roleOf(roles, row("Ville Esimerkki"), "3")).toBe("cost_share");
    expect(roleOf([member("2", "name:ESIMERKKI VILLE", "gift")], row("Ville Esimerkki"), "1")).toBeNull();
  });

  it("ignores a household default of own money, which only a member can say", () => {
    expect(roleOf([household("name:ESIMERKKI VILLE", "own_money")], row("Ville Esimerkki"))).toBeNull();
    expect(roleOf([member("1", "name:ESIMERKKI VILLE", "own_money")], row("Ville Esimerkki"))).toBe("own_money");
  });

  it("gives a row whose category was set by hand no role, and money out none under any role", () => {
    const hand = tx({ bookingDate: "2026-10-03", amountCents: 100, counterparty: "Ville Esimerkki", categorySource: "user" });
    expect(roleOf([member("1", "name:ESIMERKKI VILLE", "gift")], hand)).toBeNull();
    const out = row("Ville Esimerkki", null, -50);
    expect(roleOf([member("1", "name:ESIMERKKI VILLE", "gift")], out)).toBeNull();
    for (const role of PAYER_ROLES) expect(roleOf([member("1", "name:ESIMERKKI VILLE", role)], out)).toBeNull();
    expect(roleOf([member("1", "name:ESIMERKKI VILLE", "own_money")], out)).toBeNull();
  });
});

describe("a role in the run", () => {
  it("moves nothing without roles: the rows are those of the run without the input", () => {
    const rows = [anchor(), ...villeRows(), fromVille(-50, "2026-10-05")];
    const plain = enrichTransactions(rows, [checking], [], new Map());
    expect(run(rows, [])).toEqual(plain);
    expect(run(rows, [member("2", VILLE, "sales")])).toEqual(plain);
    expect(run(rows, [member("1", "name:KALLE ESIMERKKI", "sales")])).toEqual(plain);
  });

  it("reads Ville's rows as money from people today", () => {
    const rows = settled([anchor(), ...villeRows()], []);
    expect(rows.slice(1).map((t) => [t.category, t.categorySource])).toEqual([["p2p_in", "rule"], ["p2p_in", "rule"], ["p2p_in", "rule"]]);
  });

  it("gives each role its category and earned flag, every row of the payer past and future", () => {
    const expected: Record<PayerRole, { category: string; earned: number }> = {
      pay: { category: "salary", earned: eur(900) },
      sales: { category: "sales", earned: eur(900) },
      own_money: { category: "transfer", earned: 0 },
      gift: { category: "p2p_in", earned: 0 },
      cost_share: { category: "p2p_in", earned: 0 },
    };
    for (const role of PAYER_ROLES) {
      const rows = settled([anchor(), ...villeRows(), fromVille(300, "2026-11-04")], [member("1", VILLE, role)]);
      expect(rows.slice(1).map((t) => [t.category, t.categorySource])).toEqual(Array(4).fill([expected[role].category, "payer"]));
      expect(rows.slice(1).every((t) => t.isTransfer === (role === "own_money"))).toBe(true);
      const ctx = ctxOf(rows);
      expect([role, earnedIncome(ctx, "2026-08") + earnedIncome(ctx, "2026-09") + earnedIncome(ctx, "2026-10")]).toEqual([role, expected[role].earned]);
    }
  });

  it("makes the payer's sums earned income and the usual income from the next month on (sales, not for Maija)", () => {
    const rows = [anchor(), ...villeRows()];
    expect(usualIncome(ctxOf(settled(rows, [])), "2026-11")).toBe(0);
    const matti = settled(rows, [member("1", VILLE, "sales")]);
    expect(usualIncome(ctxOf(matti), "2026-11")).toBe(eur(300));
    // Maija's own copy of the rows is categorised on her run with her roles: nothing of Matti's reaches it
    const maija = settled(rows, [member("1", VILLE, "sales")], "2");
    expect(usualIncome(ctxOf(maija), "2026-11")).toBe(0);
  });

  it("keeps a benefit a benefit under pay, and turns a bonus of a pay payer into salary", () => {
    const rows = settled([anchor(), fromVille(300, "2026-10-03", { category: "benefits", categorySource: "user" }), fromVille(5000, "2026-10-04")], [member("1", VILLE, "pay")]);
    expect(rows[1]!.categorySource).toBe("user");
    expect(rows[2]!).toMatchObject({ category: "salary", categorySource: "payer" });
    const benefit = [tx({ bookingDate: "2026-10-03", amountCents: eur(200), counterparty: "Ville Esimerkki", category: "benefits", categorySource: "rule" })];
    applyPayerRoles(benefit, new Set(), { memberId: "1", roles: [member("1", "name:ESIMERKKI VILLE", "pay")] });
    expect(benefit[0]!).toMatchObject({ category: "benefits", categorySource: "payer" });
  });

  it("leaves a category set by hand and a row of the member's own rule as they are", () => {
    const hand = fromVille(300, "2026-10-04", { category: "gifts", categorySource: "user" });
    const rows = settled([anchor(), ...villeRows(), hand], [member("1", VILLE, "sales")]);
    expect(rows[4]!).toMatchObject({ category: "gifts", categorySource: "user" });
    const ruled = [anchor(), ...villeRows()];
    const rule = { field: "merchant" as const, pattern: "Ville Esimerkki", category: "gifts", priority: 10 };
    const withRoles = enrichTransactions(ruled, [checking], [rule], new Map(), { memberId: "1", roles: [member("1", VILLE, "sales")] });
    expect(withRoles).toEqual(enrichTransactions(ruled, [checking], [rule], new Map()));
    expect(withRoles.map((t) => t.categorySource)).toEqual(["rule", "rule", "rule"]);
  });

  it("leaves a transfer leg and a card bill alone: an own account at another bank, linked, stays a transfer", () => {
    const other: Account = { id: "acc-2", name: "Toinen pankki", iban: VILLE_IBAN, currency: "EUR", type: "checking", holder };
    const out = tx({ id: "out", bookingDate: "2026-10-03", amountCents: -eur(500), merchant: "Oma tili", counterparty: "Matti Meikalainen", counterpartyIban: VILLE_IBAN });
    const inn = tx({ id: "in", accountId: "acc-2", bookingDate: "2026-10-03", amountCents: eur(500), merchant: "Oma tili", counterparty: "Matti Meikalainen", counterpartyIban: checking.iban });
    const rows = settled([out, inn], [member("1", VILLE, "sales"), member("1", `iban:${checking.iban}`, "gift")], "1", [checking, other]);
    expect(rows.map((t) => [t.category, t.categorySource, t.isTransfer])).toEqual([["transfer", "transfer", true], ["transfer", "transfer", true]]);
    const bill = tx({ bookingDate: "2026-10-03", amountCents: eur(40), counterparty: "Ville Esimerkki", category: "card_bill", categorySource: "rule" });
    applyPayerRoles([bill], new Set(), { memberId: "1", roles: [member("1", "name:ESIMERKKI VILLE", "sales")] });
    expect(bill).toMatchObject({ category: "card_bill", categorySource: "rule" });
  });

  it("keeps a payback of a person who is not steady a return, whatever role they have (E1)", () => {
    const kalle = (euros: number, date: string) => tx({ bookingDate: date, amountCents: eur(euros), merchant: "Kalle Esimerkki", counterparty: "Kalle Esimerkki", counterpartyIban: "FI0000000000000077", description: "MobilePay", reference: null });
    const rows = [anchor(), kalle(-50, "2026-10-01"), kalle(50, "2026-10-08")];
    const plain = settled(rows, []);
    expect(plain[2]!.categorySource).toBe("match");
    for (const role of ["gift", "cost_share", "sales", "pay"] as const) {
      expect(settled(rows, [member("1", "iban:FI0000000000000077", role)])).toEqual(plain);
    }
  });

  it("gives a steady payer's row far off the usual sum no role, and keeps today's figures (E2, near miss 3)", () => {
    const base = [anchor(), ...villeRows()];
    const off = [...base, fromVille(120, "2026-10-20")];
    const plain = settled(off, []);
    expect(plain[4]!).toMatchObject({ category: "p2p_in", categorySource: "rule" });
    for (const role of ["cost_share", "gift"] as const) {
      const rows = settled(off, [member("1", VILLE, role)]);
      expect(rows.slice(1, 4).map((t) => t.categorySource)).toEqual(["payer", "payer", "payer"]);
      expect(rows[4]).toEqual(plain[4]);
      // a sum inside the band has the role
      expect(settled([...base, fromVille(310, "2026-10-20")], [member("1", VILLE, role)])[4]!.categorySource).toBe("payer");
    }
    // the other roles cover every row
    for (const role of ["pay", "sales", "own_money"] as const) expect(settled(off, [member("1", VILLE, role)])[4]!.categorySource).toBe("payer");
    // a payer that is not steady has the role on every row
    const few = settled([anchor(), fromVille(300, "2026-09-03"), fromVille(120, "2026-10-20")], [member("1", VILLE, "gift")]);
    expect(few.slice(1).map((t) => t.categorySource)).toEqual(["payer", "payer"]);
  });

  it("keeps what a steady payer is sent back as today reads it: no payback is paired, no role guesses it (E2)", () => {
    const rows = [anchor(), ...villeRows(), fromVille(-50, "2026-10-01"), fromVille(50, "2026-10-08")];
    const plain = settled(rows, []);
    expect(plain.slice(4).map((t) => [t.category, t.categorySource])).toEqual([["p2p", "rule"], ["p2p_in", "rule"]]);
    expect(settled(rows, [member("1", VILLE, "cost_share")]).slice(4)).toEqual(plain.slice(4));
  });

  it("keeps a row off the usual sum as the user sets it by hand", () => {
    const hand = fromVille(120, "2026-10-20", { category: "gifts", categorySource: "user" });
    const rows = settled([anchor(), ...villeRows(), hand], [member("1", VILLE, "cost_share")]);
    expect(rows[4]!).toMatchObject({ category: "gifts", categorySource: "user" });
  });

  it("takes the member's row over the default, and drops a removed member's answers with theirs (near miss 4)", () => {
    const rows = [anchor(), ...villeRows()];
    const roles = [member("2", VILLE, "gift"), household(VILLE, "cost_share")];
    const sources = (id: string, list: PayerRoleRow[]) => settled(rows, list, id).slice(1).map((t) => t.category);
    expect(sources("2", roles)).toEqual(["p2p_in", "p2p_in", "p2p_in"]);
    // the roles differ in what they imply for the trace, not in the category; use sales to see the member's row win
    const sales = [member("2", VILLE, "sales"), household(VILLE, "cost_share")];
    expect(sources("2", sales)).toEqual(["sales", "sales", "sales"]);
    expect(sources("1", sales)).toEqual(["p2p_in", "p2p_in", "p2p_in"]);
    // Maija removed: her row goes with her, Matti's view and the default stay
    expect(sources("1", sales.filter((r) => r.userId !== "2"))).toEqual(["p2p_in", "p2p_in", "p2p_in"]);
    expect(sources("2", sales.filter((r) => r.userId !== "2"))).toEqual(["p2p_in", "p2p_in", "p2p_in"]);
  });

  it("keeps a role for a payer whose demo rows are gone, for a real row of the same name (demo removal)", () => {
    const roles = [member("1", "name:ESIMERKKI OLLI", "sales")];
    const demo = tx({ bookingDate: "2026-10-03", amountCents: eur(200), counterparty: "Olli Esimerkki", accountId: "demo-1" });
    expect(settled([demo], roles)[0]!.category).toBe("sales");
    // the server drops the role of a key no real row has; with no role the same row reads as before
    expect(settled([demo], [])[0]!.categorySource).not.toBe("payer");
    const real = tx({ bookingDate: "2026-10-03", amountCents: eur(200), counterparty: "Olli Esimerkki" });
    expect(settled([real], roles)[0]!.category).toBe("sales");
  });
});

describe("the one-merchant run", () => {
  const island = (payers?: { memberId: string; roles: PayerRoleRow[] }, payerRows?: readonly Transaction[]) => {
    const rows = [tx({ bookingDate: "2026-10-03", amountCents: -eur(20), merchant: "Prisma", category: "groceries", categorySource: "user" })];
    return enrichIsland({ rows, before: new Map(), accounts: [checking], rules: [], oldRules: [], industries: new Map(), outsideMatches: [], payers, payerRows });
  };

  it("leaves the work to the full run when the member has a role and the payers' rows are not given", () => {
    const roles = [member("1", VILLE, "sales")];
    expect(island({ memberId: "1", roles })).toMatchObject({ ok: false, reason: expect.stringContaining("payer roles") });
    expect(island({ memberId: "1", roles }, villeRows())).toMatchObject({ ok: true });
    expect(island({ memberId: "1", roles: [] })).toMatchObject({ ok: true });
    expect(island()).toMatchObject({ ok: true });
  });

  /** Ville's rows are of two merchants (written two ways), so the median of the payer reads rows outside the island. */
  const ville = (euros: number, date: string, over: Partial<Transaction>) => fromVille(euros, date, { description: "Siirto", ...over });
  const history = () => [
    anchor(),
    ville(300, "2026-08-03", { id: "v1" }),
    ville(300, "2026-09-03", { id: "v2" }),
    ville(300, "2026-10-03", { id: "v3", merchant: "V Esimerkki" }),
    ville(300, "2026-11-03", { id: "v4", merchant: "V Esimerkki" }),
    // far from the median: a payback among the shares, which a role leaves as it was
    ville(900, "2026-11-04", { id: "v5" }),
  ];
  const rule = (category: string): CategoryRule[] => [{ id: 1, field: "merchant", pattern: "Ville Esimerkki", category, priority: 10 }];

  /** The island of one merchant against the full run over everything, for the same roles and change. */
  const same = (role: PayerRole, rules: CategoryRule[], oldRules: CategoryRule[]) => {
    const roles = [member("1", VILLE, role)];
    const stored = settledWith(history(), roles, oldRules);
    const inside = (t: Transaction) => t.merchant === "Ville Esimerkki";
    const result = enrichIsland({
      rows: stored.filter(inside),
      before: new Map(),
      accounts: [checking],
      rules,
      oldRules,
      industries: new Map(),
      outsideMatches: [],
      payers: { memberId: "1", roles },
      payerRows: stored.filter((t) => t.amountCents > 0),
    });
    expect(result.ok ? "ok" : `${role} ${rules.length}${oldRules.length} ${result.reason}`).toBe("ok");
    if (!result.ok) return;
    const changed = new Map(result.changed.map((t) => [t.id, t]));
    const full = settledWith(stored, roles, rules);
    for (const [i, t] of stored.entries()) {
      const got = changed.get(t.id) ?? t;
      if (inside(t)) expect([t.id, got.category, got.categorySource, got.isTransfer]).toEqual([t.id, full[i]!.category, full[i]!.categorySource, full[i]!.isTransfer]);
      else expect(changed.has(t.id)).toBe(false);
    }
    return { stored, full, changed };
  };
  const settledWith = (rows: Transaction[], roles: PayerRoleRow[], rules: CategoryRule[]) => {
    const changed = new Map(enrichTransactions(rows, [checking], rules, new Map(), { memberId: "1", roles }).map((t) => [t.id, t]));
    return rows.map((t) => changed.get(t.id) ?? t);
  };

  it("gives the rows of a merchant the same answer as the full run, with roles present", () => {
    for (const role of PAYER_ROLES) {
      // a rule leaves the roles (its rows are the member's own choice), and another rule in its place changes nothing more
      same(role, rule("hobbies"), []);
      same(role, rule("health"), rule("hobbies"));
      same(role, [], []);
    }
    // the roles moved the rows that the island reads back as stored: the usual sums go, the off-median one stays
    const kept = same("cost_share", [], [])!;
    expect(kept.stored.filter((t) => t.merchant === "Ville Esimerkki").map((t) => [t.category, t.categorySource]).slice(0, 2)).toEqual([["p2p_in", "payer"], ["p2p_in", "payer"]]);
    expect(kept.stored[5]!.categorySource).not.toBe("payer");
    expect(kept.changed.size).toBe(0);
    // a rule on the merchant takes its rows from the role
    const ruled = same("sales", rule("hobbies"), [])!;
    expect([...ruled.changed.values()].map((t) => [t.id, t.category, t.categorySource])).toEqual([["v1", "hobbies", "rule"], ["v2", "hobbies", "rule"], ["v5", "hobbies", "rule"]]);
  });
});

describe("own money, money in only (C)", () => {
  const own = "FI9900000000000002";
  const toSelf = (euros: number, date: string, over: Partial<Transaction> = {}) =>
    tx({ bookingDate: date, amountCents: eur(euros), merchant: "M Meikalainen", counterparty: "M MEIKALAINEN", counterpartyIban: own, reference: null, ...over });
  const asOwn = [member("1", `iban:${own}`, "own_money")];
  // the money comes back after the 90 days in which a payback by a person is paired
  const rows = () => [anchor(), toSelf(-500, "2026-09-02"), toSelf(500, "2026-12-05")];

  it("turns the money in into Omat siirrot and never moves the money out to the same payer", () => {
    const list = rows();
    const before = settled(list, []);
    expect(before.slice(1).map((t) => [t.category, t.categorySource])).toEqual([["p2p", "rule"], ["income", "default"]]);
    expect(earnedIncome(ctxOf(before), "2026-12")).toBe(eur(500));
    const after = settled(list, asOwn);
    expect(after[1]).toEqual(before[1]);
    expect(after[2]!).toMatchObject({ category: "transfer", categorySource: "payer", isTransfer: true });
    expect(earnedIncome(ctxOf(after), "2026-12")).toBe(0);
  });

  it("leaves a pair that today pairs as a return: the sum back in full within the days is already net nothing", () => {
    const close = [anchor(), toSelf(-500, "2026-09-02"), toSelf(500, "2026-09-05")];
    const before = settled(close, []);
    expect(before[2]!.categorySource).toBe("match");
    expect(settled(close, asOwn)).toEqual(before);
  });

  it("leaves the row a hand category decided, and the rows of another payer", () => {
    const hand = toSelf(500, "2026-09-02", { category: "gifts", categorySource: "user" });
    expect(settled([anchor(), hand], asOwn)[1]!).toMatchObject({ category: "gifts", categorySource: "user" });
    const other = tx({ bookingDate: "2026-09-02", amountCents: eur(500), counterparty: "Joku Muu", counterpartyIban: "FI0000000000000055" });
    const list = [anchor(), other];
    expect(settled(list, asOwn)[1]).toEqual(settled(list, [])[1]);
  });
});

describe("what a role leaves alone", () => {
  it("keeps a refund a refund under every role: a refund word's category and money in on a shop's category", () => {
    const claim = tx({ bookingDate: "2026-09-20", amountCents: eur(40), merchant: "Esimerkki Oy", counterparty: "Esimerkki Oy", counterpartyIban: "FI6612345600000456", category: "reimbursements", categorySource: "rule" });
    const shop = tx({ bookingDate: "2026-09-21", amountCents: eur(40), merchant: "Esimerkki Oy", counterparty: "Esimerkki Oy", counterpartyIban: "FI6612345600000456", category: "electronics", categorySource: "merchant" });
    const salary = tx({ bookingDate: "2026-09-15", amountCents: eur(2500), merchant: "Esimerkki Oy", counterparty: "Esimerkki Oy", counterpartyIban: "FI6612345600000456", category: "salary", categorySource: "rule" });
    for (const role of ["pay", "sales", "gift", "cost_share"] as const) {
      const rows = [claim, shop, salary].map((t) => ({ ...t }));
      applyPayerRoles(rows, new Set(), { memberId: "1", roles: [member("1", "iban:FI6612345600000456", role)] });
      expect(rows.map((t) => t.categorySource)).toEqual(["rule", "merchant", "payer"]);
    }
  });
});

describe("the questions about a payer", () => {
  const range = { from: "2026-11-01", to: today };
  const ask = (rows: Transaction[], roles: PayerRoleRow[] | null, accounts: Account[] = [checking], marks: typeof NO_INPUTS.marks = []) => {
    const enriched = settled(rows, roles ?? [], "1", accounts);
    return buildQuestions(createContext(enriched, accounts, today), range, { ...NO_INPUTS, marks, ...(roles ? { payers: { memberId: "1", roles } } : {}) });
  };
  const payersOf = (q: ReturnType<typeof ask>) => q.items.flatMap((i) => (i.kind === "payer" ? [i] : []));

  it("asks nothing about payers when the inputs carry no roles, and keeps five questions", () => {
    const q = ask([anchor(), ...villeRows()], null);
    expect(payersOf(q)).toEqual([]);
  });

  it("asks one question for a steady payer with the share of the common costs proposed", () => {
    const q = payersOf(ask([anchor(), ...villeRows()], []));
    expect(q).toEqual([{ kind: "payer", key: VILLE, merchant: "Ville Esimerkki", cents: eur(900), count: 3, lastDate: "2026-10-03", options: ["cost_share", "sales", "own_money", "gift", "pay"], steady: true, proposal: "cost_share", offMedianCents: [] }]);
  });

  it("lists the rows off the usual sum, and does not ask about a payer that is neither steady nor large", () => {
    expect(payersOf(ask([anchor(), ...villeRows(), fromVille(50, "2026-10-08")], []))[0]!.offMedianCents).toEqual([eur(50)]);
    expect(payersOf(ask([anchor(), fromVille(50, "2026-10-08"), fromVille(40, "2026-09-08")], []))).toEqual([]);
    // reaching the limit asks, with no proposal: not steady
    const big = payersOf(ask([anchor(), fromVille(60, "2026-10-08"), fromVille(40, "2026-09-08")], []));
    expect(big).toMatchObject([{ cents: eur(100), steady: false, proposal: null }]);
  });

  it("does not ask when the payer has an answer in either scope, and asks again for a member who has none", () => {
    expect(payersOf(ask([anchor(), ...villeRows()], [member("1", VILLE, "gift")]))).toEqual([]);
    expect(payersOf(ask([anchor(), ...villeRows()], [household(VILLE, "gift")]))).toEqual([]);
    expect(payersOf(ask([anchor(), ...villeRows()], [member("2", VILLE, "gift")]))).toHaveLength(1);
    // an answer by name for an IBAN row, and two names that disagree leave the question
    expect(payersOf(ask([anchor(), ...villeRows()], [member("1", "name:ESIMERKKI VILLE", "gift")]))).toEqual([]);
    expect(payersOf(ask([anchor(), ...villeRows()], [member("1", "name:ESIMERKKI VILLE", "gift"), member("1", "name:ESIMERKKI MATIAS VILLE", "sales")]))).toHaveLength(1);
  });

  it("is set aside by a dismissed mark of the payer or of its merchant", () => {
    const mark = (subject: string) => [{ subject: `question:payee:${subject}`, mark: "dismissed" as const, markedAt: "2026-10-01T10:00:00" }];
    expect(payersOf(ask([anchor(), ...villeRows()], [], [checking], mark(VILLE)))).toEqual([]);
    expect(payersOf(ask([anchor(), ...villeRows()], [], [checking], mark("Ville Esimerkki")))).toEqual([]);
  });

  it("proposes own money for the member's own name at an IBAN that is no account of theirs, and nothing for initials", () => {
    const own = "FI9900000000000002";
    const sent = (name: string) => tx({ bookingDate: "2026-09-05", amountCents: eur(500), merchant: name, counterparty: name, counterpartyIban: own });
    expect(payersOf(ask([anchor(), sent("Matti Meikalainen")], []))).toMatchObject([{ proposal: "own_money" }]);
    expect(payersOf(ask([anchor(), sent("M MEIKALAINEN")], []))).toMatchObject([{ proposal: null }]);
    expect(payersOf(ask([anchor(), sent("Matti Meikalainen Kiinteistot Oy")], []))).toMatchObject([{ proposal: null }]);
  });

  it("asks at most three questions of every kind together, the largest first, and takes over the payee question of the same money", () => {
    const payer = (n: number, euros: number) => [1, 2, 3].map((m) => tx({ bookingDate: `2026-0${7 + m}-03`, amountCents: eur(euros), merchant: `Maksaja ${n}`, counterparty: `Maksaja ${n} Esimerkki`, counterpartyIban: `FI000000000000010${n}` }));
    const rows = [anchor(), ...[1, 2, 3, 4].flatMap((n) => payer(n, 100 * n))];
    const q = ask(rows, []);
    expect(q.items.map((i) => (i.kind === "payer" ? i.cents : 0))).toEqual([eur(1200), eur(900), eur(600)]);
    expect(q.total).toBe(4);
    // without roles the same rows ask the old way, one question per merchant
    const old = ask(rows, null);
    expect(old.items.every((i) => i.kind === "payee_in" || i.kind === "payee_out")).toBe(true);
  });

  it("never asks a payee question for the money a payer's role leaves alone, and the role stands (the off-sum row)", () => {
    const rows = [anchor(), ...villeRows().map((t) => ({ ...t, description: "Tilisiirto" })), fromVille(120, "2026-10-20", { description: "Tilisiirto" })];
    const roles = [member("1", VILLE, "cost_share")];
    const q = ask(rows, roles);
    expect(q.items).toEqual([]);
    // the same rows without roles in the inputs are asked the old way
    expect(ask(rows, null).items.map((i) => i.kind)).toEqual(["payee_in"]);
  });

  it("offers own money for a person and not for a company or a lender", () => {
    const company = (n: string, euros: number, date: string) => tx({ bookingDate: date, amountCents: eur(euros), merchant: n, counterparty: n, counterpartyIban: "FI7712345600000789" });
    const rows = [anchor(), ...["2026-08-10", "2026-09-10", "2026-10-10"].map((d) => company("Esimerkkitori Oy", 150, d))];
    expect(payersOf(ask(rows, []))[0]!.options).toEqual(["cost_share", "sales", "gift", "pay"]);
    expect(payersOf(ask([anchor(), ...villeRows()], []))[0]!.options).toContain("own_money");
  });

  it("reads the usual sum from every row of the member, as the run does, not from the window", () => {
    // 300 in each of three months, but only the last 100 days are in the window: the old rows still make the sum usual
    const old = [fromVille(300, "2025-01-03"), fromVille(300, "2025-02-03"), fromVille(300, "2025-03-03"), fromVille(60, "2026-10-03", { description: "MobilePay" }), fromVille(60, "2026-10-04")];
    const q = payersOf(ask([anchor(), ...old], []));
    expect(q).toMatchObject([{ steady: true, offMedianCents: [eur(60), eur(60)] }]);
  });
});
