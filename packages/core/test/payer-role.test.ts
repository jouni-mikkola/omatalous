import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import { expectedIncome } from "../src/analysis/expected.ts";
import { earnedIncome } from "../src/analysis/usual.ts";
import { enrichIsland, enrichTransactions } from "../src/pipeline.ts";
import { applyPayerRoles, isPersonName, PAYER_ROLES, payerKeyOf, payerKeysOf, payerRoleOf, pooledIbans, WALLET_PAYER_KEY } from "../src/payer-role.ts";
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

  it.each(["E-LASKU", "MOB.PAY", "Mobile Pay", "Siirto"])("is no person when the name is that of a way to pay (%s)", (name) => {
    expect(isPersonName(name)).toBe(false);
    expect(isPersonName("Ville Esimerkki")).toBe(true);
    expect(isPersonName(null)).toBe(true);
  });

  it("keys wallet money that names no sender by the wallet, not by the wallet operator's account", () => {
    const row = { counterpartyIban: VILLE_IBAN, counterparty: null, description: "MobilePay" };
    expect(payerKeyOf(row)).toBe(WALLET_PAYER_KEY);
  });

  describe("on an account many unrelated senders pay from", () => {
    const named = (counterparty: string | null, amountCents = eur(10), description?: string) => ({ counterpartyIban: VILLE_IBAN, counterparty, amountCents, ...(description ? { description } : {}) });
    const keysOf = (rows: ReturnType<typeof named>[]) => {
      const keyOf = payerKeysOf(rows, pooledIbans(rows));
      return rows.map((t) => keyOf(t));
    };
    const permutations = <T>(items: readonly T[]): T[][] => (items.length < 2 ? [[...items]] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])));

    it("keys the money by the name", () => {
      const rows = [named("Ville Esimerkki"), named("Liisa Testinen"), named("Matti Meikalainen"), named("Meikalainen Matti")];
      expect(pooledIbans(rows)).toEqual(new Set([VILLE_IBAN]));
      const keys = keysOf(rows);
      expect(new Set(keys).size).toBe(3);
      expect(keys[0]).toBe("name:ESIMERKKI VILLE");
      expect(keys[2]).toBe(keys[3]);
      // two names are a couple's or one person's account: the number still tells the payer
      expect(pooledIbans(rows.slice(2))).toEqual(new Set());
      expect(keysOf(rows.slice(2))[0]).toBe(VILLE);
    });

    it("keeps the account number of a row that names no sender", () => {
      const rows = [named("Ville Esimerkki"), named("Liisa Testinen"), named("Matti Meikalainen"), named(null, eur(10), "Maksu")];
      expect(pooledIbans(rows)).toEqual(new Set([VILLE_IBAN]));
      expect(keysOf(rows)[3]).toBe(VILLE);
      expect(payerKeyOf(rows[3]!, pooledIbans(rows))).toBe(VILLE);
    });

    it("counts the senders, not the payees: two names in and one out is no pool", () => {
      const rows = [named("Ville Esimerkki"), named("Liisa Testinen"), named("Matti Meikalainen", -eur(10))];
      expect(pooledIbans(rows)).toEqual(new Set());
      expect(keysOf(rows.slice(0, 2))).toEqual([VILLE, VILLE]);
    });

    it("is no pool of the names one employer is written with", () => {
      const rows = [named("Firma Oy"), named("Firma Oy Ab"), named("FIRMA OY PALKAT"), named("Firma Kiinteistot Oy")];
      expect(pooledIbans(rows)).toEqual(new Set());
      expect(pooledIbans([...rows, named("Ville Esimerkki"), named("Liisa Testinen")])).toEqual(new Set());
    });

    it("is no pool of the names of a way to pay", () => {
      const rows = [named("E-LASKU"), named("MOB.PAY"), named("Mobile Pay"), named("Ville Esimerkki"), named("Liisa Testinen")];
      expect(pooledIbans(rows)).toEqual(new Set());
    });

    it("is no pool of a joint account's holders with their one-word and initial variants", () => {
      const rows = [named("Matti Meikalainen"), named("Liisa Meikalainen"), named("M Meikalainen"), named("MEIKALAINEN"), named("Matti M")];
      expect(pooledIbans(rows)).toEqual(new Set());
      // a third sender who is no one of them makes it a pool
      expect(pooledIbans([...rows, named("Ville Esimerkki")])).toEqual(new Set());
      expect(pooledIbans([...rows, named("Ville Esimerkki"), named("Aino Testinen")])).toEqual(new Set([VILLE_IBAN]));
    });

    it("counts alike whatever the order of the rows", () => {
      // the father's and the son's names both hold the short name, and do not match each other
      const names = ["Matti Meikalainen", "Meikalainen Matti Juhani", "Meikalainen Matti Pekka", "Ville Esimerkki"];
      for (const order of permutations(names)) expect(pooledIbans(order.map((n) => named(n))), order.join(", ")).toEqual(new Set());
      for (const order of permutations([...names, "Liisa Testinen"])) expect(pooledIbans(order.map((n) => named(n))), order.join(", ")).toEqual(new Set([VILLE_IBAN]));
    });
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

  it("reaches wallet money that names no sender by the wallet's answer, else by an answer given for the wallet operator's account", () => {
    const wallet = tx({ bookingDate: "2026-10-03", amountCents: eur(20), counterparty: null, counterpartyIban: VILLE_IBAN, description: "MobilePay" });
    expect(roleOf([member("1", VILLE, "gift")], wallet)).toBe("gift");
    expect(roleOf([member("1", VILLE, "gift"), member("1", WALLET_PAYER_KEY, "sales")], wallet)).toBe("sales");
    expect(roleOf([member("1", WALLET_PAYER_KEY, "sales")], wallet)).toBe("sales");
    // a named sender on the same account is still told by the account's answer
    expect(roleOf([member("1", VILLE, "gift")], row("Liisa Testinen", VILLE_IBAN))).toBe("gift");
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
    expect(expectedIncome(ctxOf(settled(rows, [])), "2026-11")).toBe(0);
    const matti = settled(rows, [member("1", VILLE, "sales")]);
    expect(expectedIncome(ctxOf(matti), "2026-11")).toBe(eur(300));
    // Maija's own copy of the rows is categorised on her run with her roles: nothing of Matti's reaches it
    const maija = settled(rows, [member("1", VILLE, "sales")], "2");
    expect(expectedIncome(ctxOf(maija), "2026-11")).toBe(0);
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
    const rule = { field: "merchant" as const, pattern: "Ville Esimerkki", category: "tax_refund", priority: 10 };
    const withRoles = enrichTransactions(ruled, [checking], [rule], new Map(), { memberId: "1", roles: [member("1", VILLE, "sales")] });
    expect(withRoles).toEqual(enrichTransactions(ruled, [checking], [rule], new Map()));
    expect(withRoles.map((t) => t.categorySource)).toEqual(["rule", "rule", "rule"]);
  });

  it("lets the role read money in from a payer whose member rule is one of spending, which is about money out", () => {
    const ruled = [anchor(), ...villeRows()];
    const rule = { field: "merchant" as const, pattern: "Ville Esimerkki", category: "home", priority: 10 };
    const changed = new Map(enrichTransactions(ruled, [checking], [rule], new Map(), { memberId: "1", roles: [member("1", VILLE, "sales")] }).map((t) => [t.id, t]));
    expect(ruled.slice(1).map((t) => [changed.get(t.id)?.category, changed.get(t.id)?.categorySource])).toEqual(Array(3).fill(["sales", "payer"]));
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
  const ville = (euros: number, date: string, over: Partial<Transaction>) => fromVille(euros, date, { description: "Siirto", reference: "1234", ...over });
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
      same(role, rule("tax_refund"), []);
      same(role, rule("investment_income"), rule("tax_refund"));
      same(role, [], []);
    }
    // the roles moved the rows that the island reads back as stored: the usual sums go, the off-median one stays
    const kept = same("cost_share", [], [])!;
    expect(kept.stored.filter((t) => t.merchant === "Ville Esimerkki").map((t) => [t.category, t.categorySource]).slice(0, 2)).toEqual([["p2p_in", "payer"], ["p2p_in", "payer"]]);
    expect(kept.stored[5]!.categorySource).not.toBe("payer");
    expect(kept.changed.size).toBe(0);
    // a rule on the merchant takes its rows from the role
    const ruled = same("sales", rule("tax_refund"), [])!;
    expect([...ruled.changed.values()].map((t) => [t.id, t.category, t.categorySource])).toEqual([["v1", "tax_refund", "rule"], ["v2", "tax_refund", "rule"], ["v5", "tax_refund", "rule"]]);
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
    expect(before.slice(1).map((t) => [t.category, t.categorySource])).toEqual([["p2p", "rule"], ["p2p_in", "rule"]]);
    expect(earnedIncome(ctxOf(before), "2026-12")).toBe(0);
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
    // the rows it counts go with it, for Tarkistettavat to show
    expect(q.map((i) => i.rowIds?.length)).toEqual([3]);
    expect(q.map(({ rowIds: _ids, ...rest }) => rest)).toEqual([{ kind: "payer", key: VILLE, merchant: "Ville Esimerkki", cents: eur(900), count: 3, lastDate: "2026-10-03", options: ["cost_share", "sales", "own_money", "gift", "pay"], steady: true, proposal: "cost_share", offMedianCents: [] }]);
  });

  it("asks nothing about steady transfers between two tracked accounts that no pool of senders pays from", () => {
    const savings: Account = { id: "acc-2", name: "Yhteistili", iban: VILLE_IBAN, currency: "EUR", type: "checking", holder: "Liisa Meikalainen" };
    const legs = ["2026-08-03", "2026-09-03", "2026-10-03"].flatMap((date) => [
      tx({ id: `out-${date}`, bookingDate: date, amountCents: -eur(300), merchant: "Yhteistili", counterparty: "Liisa Meikalainen", counterpartyIban: VILLE_IBAN }),
      tx({ id: `in-${date}`, accountId: "acc-2", bookingDate: date, amountCents: eur(300), merchant: "Matti Meikalainen", counterparty: "Matti Meikalainen", counterpartyIban: checking.iban }),
    ]);
    expect(pooledIbans(legs)).toEqual(new Set());
    expect(settled([anchor(), ...legs], [], "1", [checking, savings]).filter((t) => t.id.startsWith("in-")).map((t) => t.isTransfer)).toEqual([true, true, true]);
    expect(payersOf(ask([anchor(), ...legs], [], [checking, savings]))).toEqual([]);
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

  it("asks once about a person whose rows name them by account number and by name, under one key", () => {
    const rows = [
      fromVille(300, "2026-10-03", { counterparty: "Jarkko Esimerkki", merchant: "Jarkko Esimerkki" }),
      fromVille(300, "2026-10-10", { counterparty: "Jarkko Esimerkki", merchant: "Jarkko Esimerkki" }),
      fromVille(300, "2026-10-17", { counterparty: "Esimerkki Jarkko Matias", merchant: "Esimerkki Jarkko Matias", counterpartyIban: null }),
      fromVille(300, "2026-10-24", { counterparty: "Esimerkki Jarkko Matias", merchant: "Esimerkki Jarkko Matias", counterpartyIban: null }),
    ];
    const q = payersOf(ask(rows, []));
    expect(q.map((i) => [i.key, i.count, i.cents])).toEqual([["name:ESIMERKKI JARKKO MATIAS", 4, eur(1200)]]);
  });

  it("reads a steady payer's usual sum across the account number and the name, and keeps a dismissal made under the account number", () => {
    const split = [
      fromVille(30, "2026-08-03", { counterparty: "Jarkko Esimerkki", merchant: "Jarkko Esimerkki" }),
      fromVille(30, "2026-09-03", { counterparty: "Jarkko Esimerkki", merchant: "Jarkko Esimerkki" }),
      fromVille(30, "2026-10-03", { counterparty: "Esimerkki Jarkko Matias", merchant: "Esimerkki Jarkko Matias", counterpartyIban: null }),
    ];
    // 90,00 is under the asking sum: the question stands only because the three rows together are steady
    expect(payersOf(ask([anchor(), ...split], [])).map((i) => [i.key, i.steady, i.proposal])).toEqual([["name:ESIMERKKI JARKKO MATIAS", true, "cost_share"]]);
    const mark = [{ subject: `question:payee:${VILLE}`, mark: "dismissed" as const, markedAt: "2026-10-01T10:00:00" }];
    expect(payersOf(ask([anchor(), ...split], [], [checking], mark))).toEqual([]);
    // near miss: a dismissal of another account number leaves the question
    const other = [{ ...mark[0]!, subject: "question:payee:iban:FI9900000000000003" }];
    expect(payersOf(ask([anchor(), ...split], [], [checking], other))).toHaveLength(1);
  });

  it("still asks about the rows an answer by account number does not reach", () => {
    const rows = [
      fromVille(300, "2026-10-03", { counterparty: "Jarkko Esimerkki", merchant: "Jarkko Esimerkki" }),
      fromVille(300, "2026-10-17", { counterparty: "Jarkko Esimerkki", merchant: "Jarkko Esimerkki", counterpartyIban: null }),
    ];
    const q = payersOf(ask(rows, [household(VILLE, "gift")]));
    expect(q.map((i) => [i.count, i.cents])).toEqual([[1, eur(300)]]);
  });
});

describe("payerKeysOf", () => {
  const keyed = (rows: Partial<Transaction>[]) => {
    const all = rows.map((r) => tx({ bookingDate: "2026-10-01", amountCents: eur(10), ...r }));
    const keyOf = payerKeysOf(all, pooledIbans(all));
    return all.map((t) => keyOf(t));
  };

  it("gives one key to a person written in two orders, with a middle name left out, and by account number", () => {
    expect(
      keyed([
        { counterparty: "Jarkko Esimerkki", counterpartyIban: VILLE_IBAN },
        { counterparty: "Esimerkki Jarkko Matias" },
        { counterparty: "Esimerkki Jarkko Matias" },
        { counterparty: "ESIMERKKI JARKKO" },
      ]),
    ).toEqual(["name:ESIMERKKI JARKKO MATIAS", "name:ESIMERKKI JARKKO MATIAS", "name:ESIMERKKI JARKKO MATIAS", "name:ESIMERKKI JARKKO MATIAS"]);
  });

  it("keeps two people apart, and a company with a person's words", () => {
    expect(keyed([{ counterparty: "Jarkko Esimerkki" }, { counterparty: "Matti Esimerkki" }, { counterparty: "Jarkko Esimerkki Kiinteistot Oy" }])).toEqual(["name:ESIMERKKI JARKKO", "name:ESIMERKKI MATTI", "name:ESIMERKKI JARKKO KIINTEISTOT OY"]);
  });

  describe("never joins two people", () => {
    const apart = (rows: Partial<Transaction>[]) => {
      const all = rows.map((r) => tx({ bookingDate: "2026-10-01", amountCents: eur(10), ...r }));
      const keyOf = payerKeysOf(all, pooledIbans(all));
      expect(all.map((t) => keyOf(t))).toEqual(all.map((t) => payerKeyOf(t)));
    };

    it("when one name matches two longer names that do not match each other (a father and a son)", () => {
      apart([{ counterparty: "Jarkko Esimerkki" }, { counterparty: "Esimerkki Jarkko Matias" }, { counterparty: "Esimerkki Jarkko Pekka" }]);
      // an account number written with the short name belongs to none of the three
      apart([{ counterparty: "Jarkko Esimerkki", counterpartyIban: VILLE_IBAN }, { counterparty: "Esimerkki Jarkko Matias" }, { counterparty: "Esimerkki Jarkko Pekka" }]);
    });

    it("when a couple is written in one name next to the names of each", () => {
      apart([{ counterparty: "Matti ja Liisa Esimerkki" }, { counterparty: "Matti Esimerkki" }, { counterparty: "Liisa Esimerkki" }]);
    });

    it("when a joint account number is written with the names of two holders", () => {
      apart([{ counterparty: "Matti Esimerkki", counterpartyIban: VILLE_IBAN }, { counterparty: "Liisa Esimerkki", counterpartyIban: VILLE_IBAN }, { counterparty: "Matti Esimerkki" }, { counterparty: "Liisa Esimerkki" }]);
    });
  });

  it("keeps the account number for a row of a joined number that has no name, which a name answer cannot reach", () => {
    expect(keyed([{ counterparty: "Jarkko Esimerkki", counterpartyIban: VILLE_IBAN }, { counterparty: null, counterpartyIban: VILLE_IBAN }, { counterparty: "Jarkko Esimerkki" }])).toEqual(["name:ESIMERKKI JARKKO", VILLE, "name:ESIMERKKI JARKKO"]);
  });

  it("leaves an account number alone when no name of its rows is another key's", () => {
    expect(keyed([{ counterparty: "Jarkko Esimerkki", counterpartyIban: VILLE_IBAN }, { counterparty: "Matti Meikalainen" }])).toEqual([VILLE, "name:MATTI MEIKALAINEN"]);
  });
});
