import { describe, expect, it } from "vitest";
import { accountHolder, accountName, accountType, cardMask, creditLimitCents } from "../src/connectors/enable-banking/mapper.ts";
import { seedCsv } from "./csv-seed.ts";
import { NOW, setupApp } from "./helpers.ts";

// modelled on Nordea's netbank export of a checking and a savings account (review data)
const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const CHECKING = "FI12 1234 5600 0785 41";
const SAVINGS = "FI45 1234 5600 0921 77";
const EMPLOYER = "FI96 1234 5600 0007 93";
const file = (...rows: string[]) => [HEADER, ...rows].join("\n");

const checkingCsv = file(
  `2026/09/30;1799,69;${EMPLOYER};${CHECKING};RAKENNUS-SAARINEN OY;PALKKA;;EUR`,
  `2026/09/16;-300,00;${CHECKING};${SAVINGS};LAAKSONEN MIKKO JA ANNA;OMA SIIRTO;;EUR`,
  `2026/09/05;-44,15;${CHECKING};;;LIDL TIKKURILA;;EUR`,
  `2026/09/03;-106,66;${CHECKING};;;PRISMA TIKKURILA;;EUR`,
  `2026/08/16;-300,00;${CHECKING};${SAVINGS};LAAKSONEN MIKKO JA ANNA;OMA SIIRTO;;EUR`,
  `2026/08/14;1887,24;${EMPLOYER};${CHECKING};RAKENNUS-SAARINEN OY;PALKKA;;EUR`,
  `2026/07/29;800,00;${SAVINGS};${CHECKING};LAAKSONEN MIKKO JA ANNA;OMA SIIRTO;;EUR`,
);
const savingsCsv = file(
  `2026/09/16;300,00;${CHECKING};${SAVINGS};LAAKSONEN MIKKO JA ANNA;OMA SIIRTO;;EUR`,
  `2026/08/16;300,00;${CHECKING};${SAVINGS};LAAKSONEN MIKKO JA ANNA;OMA SIIRTO;;EUR`,
  `2026/07/29;-800,00;${SAVINGS};${CHECKING};LAAKSONEN MIKKO JA ANNA;OMA SIIRTO;;EUR`,
  `2025/12/31;12,40;;${SAVINGS};;KORKO;;EUR`,
);
/** No payer or payee columns: nothing says which account the file is from. */
const plainCsv = "Kirjauspäivä;Määrä;Nimi;Otsikko\n2026/09/01;-12,00;;XYZZY TUNTEMATON\n";

type Tx = { accountId: string; amountCents: number; isTransfer: boolean; description: string | null };

async function importBoth() {
  const app = await setupApp();
  const checking = await seedCsv(app.s, app.admin, { content: checkingCsv, accountName: "Käyttötili", accountType: "checking" });
  const savings = await seedCsv(app.s, app.admin, { content: savingsCsv, accountName: "Säästötili", accountType: "savings" });
  expect([checking.status, savings.status]).toEqual([200, 200]);
  return { ...app, checkingId: checking.body.accountId as string, savingsId: savings.body.accountId as string };
}

describe("old CSV accounts: own transfers", () => {
  it("own transfers between two imported accounts pair up and count as saved", async () => {
    const { admin, checkingId, savingsId } = await importBoth();
    const accounts = new Map((await admin.call("GET", "/api/meta")).body.accounts.map((a: { id: string; iban: string | null }) => [a.id, a.iban]));
    expect(accounts.get(checkingId)).toBe("FI1212345600078541");
    expect(accounts.get(savingsId)).toBe("FI4512345600092177");

    const items: Tx[] = (await admin.call("GET", `/api/transactions?q=${encodeURIComponent("oma siirto")}&limit=50`)).body.items;
    expect(items).toHaveLength(6);
    expect(items.every((t) => t.isTransfer)).toBe(true);

    const september = (await admin.call("GET", "/api/dashboard?from=2026-09-01&to=2026-09-30")).body.totals;
    expect(september).toMatchObject({ incomeCents: 179969, savedCents: 30000, expenseCents: 4415 + 10666 });
    // taking money out of savings is negative saving, and not income on checking
    const july = (await admin.call("GET", "/api/dashboard?from=2026-07-01&to=2026-07-31")).body.totals;
    expect(july).toMatchObject({ incomeCents: 0, savedCents: -80000 });
  });
});

describe("old CSV accounts: names", () => {
  it("a renamed account keeps its rows when a new file uses its old name", async () => {
    const { admin, s } = await setupApp();
    const first = await seedCsv(s, admin, { content: checkingCsv, accountName: "Vanha" });
    await admin.call("PATCH", `/api/accounts/${first.body.accountId}`, { name: "Uusi" });
    const second = await seedCsv(s, admin, { content: plainCsv, accountName: "Vanha" });
    expect(second.status).toBe(200);
    expect(second.body.accountId).not.toBe(first.body.accountId);
    const names = (await admin.call("GET", "/api/meta")).body.accounts.map((a: { name: string }) => a.name);
    expect(names.sort()).toEqual(["Uusi", "Vanha"]);
    expect((await admin.call("GET", `/api/transactions?accountId=${first.body.accountId}`)).body.total).toBe(7);
  });
});

describe("account balance", () => {
  it("can be set by hand on an imported account", async () => {
    const { admin, s, adminId } = await setupApp();
    const { accountId } = (await seedCsv(s, admin, { content: checkingCsv, accountName: "Käyttötili" })).body;
    const version = await s.settings.dataVersionOf([adminId]);
    const r = await admin.call("PATCH", `/api/accounts/${accountId}`, { balanceCents: 123456 });
    expect(r).toMatchObject({ status: 200, body: { id: accountId, balanceCents: 123456, balanceAt: NOW.toISOString(), name: "Käyttötili" } });
    expect(await s.settings.dataVersionOf([adminId])).not.toBe(version);
    expect((await admin.call("PATCH", `/api/accounts/${accountId}`, { balanceCents: -100_000_000_000 })).body.balanceCents).toBe(-100_000_000_000);
    expect((await admin.call("PATCH", `/api/accounts/${accountId}`, { balanceCents: 0 })).body.balanceCents).toBe(0);
  });

  it("must be whole cents within limits", async () => {
    const { admin, s } = await setupApp();
    const { accountId } = (await seedCsv(s, admin, { content: checkingCsv, accountName: "Käyttötili" })).body;
    for (const balanceCents of [12.5, "100", null, 100_000_000_001, -100_000_000_001, Number.NaN, true]) {
      const r = await admin.call("PATCH", `/api/accounts/${accountId}`, { balanceCents });
      expect(r, String(balanceCents)).toMatchObject({ status: 400, body: { error: "Virheellinen saldo." } });
    }
    expect((await admin.call("PATCH", `/api/accounts/${accountId}`, { balance: 1 })).status).toBe(400);
    expect((await admin.call("GET", "/api/meta")).body.accounts[0].balanceCents).toBeNull();
  });

  it("is only for imported accounts, and only the owner's", async () => {
    const { admin, s, member } = await setupApp();
    await admin.call("POST", "/api/demo");
    const demo = (await admin.call("GET", "/api/meta")).body.accounts[0];
    const r = await admin.call("PATCH", `/api/accounts/${demo.id}`, { balanceCents: 100 });
    expect(r).toMatchObject({ status: 400, body: { error: "Saldon voi asettaa vain tuodulle tilille." } });

    const { accountId } = (await seedCsv(s, admin, { content: checkingCsv, accountName: "Käyttötili" })).body;
    const eero = await member("eero");
    expect((await eero.call("PATCH", `/api/accounts/${accountId}`, { balanceCents: 100 })).status).toBe(404);
    expect((await admin.call("GET", "/api/meta")).body.accounts.find((a: { id: string }) => a.id === accountId).balanceCents).toBeNull();
  });
});

describe("deleting an account", () => {
  it("removes an imported account with its rows and shares, and recounts transfers", async () => {
    const { admin, s, adminId, member, checkingId, savingsId } = await importBoth();
    const eero = await member("eero");
    await admin.call("PUT", `/api/accounts/${checkingId}/shares/${eero.id}`);
    expect((await eero.call("GET", "/api/meta")).body.sharedAccounts).toHaveLength(1);
    const version = await s.settings.dataVersionOf([adminId]);

    expect((await admin.call("DELETE", `/api/accounts/${checkingId}`)).body).toEqual({ ok: true });
    expect(await s.settings.dataVersionOf([adminId])).not.toBe(version);
    const meta = (await admin.call("GET", "/api/meta")).body;
    expect(meta.accounts.map((a: { id: string }) => a.id)).toEqual([savingsId]);
    expect(meta.shares).toEqual([]);
    expect((await eero.call("GET", "/api/meta")).body.sharedAccounts).toEqual([]);
    const left: Tx[] = (await admin.call("GET", "/api/transactions?limit=50")).body.items;
    expect(left).toHaveLength(4);
    expect(left.every((t) => t.accountId === savingsId)).toBe(true);
    // the other legs lost their partner: no longer transfers
    expect(left.some((t) => t.isTransfer)).toBe(false);
    expect((await s.db.first<{ n: number }>("SELECT count(*) AS n FROM transactions WHERE account_id = ?", [checkingId]))?.n).toBe(0);
  });

  it("removes a demo account; refuses a bank-linked one and another member's", async () => {
    const { admin, s, adminId, member } = await setupApp();
    await admin.call("POST", "/api/demo");
    const accounts = (await admin.call("GET", "/api/meta")).body.accounts;
    const card = accounts.find((a: { type: string }) => a.type === "credit_card");
    const eero = await member("eero");
    expect((await eero.call("DELETE", `/api/accounts/${card.id}`)).status).toBe(404);
    expect((await admin.call("GET", `/api/transactions?accountId=${card.id}`)).body.total).toBeGreaterThan(0);

    expect((await admin.call("DELETE", `/api/accounts/${card.id}`)).status).toBe(200);
    expect((await admin.call("GET", `/api/transactions?accountId=${card.id}`)).body.total).toBe(0);
    expect((await admin.call("GET", "/api/meta")).body.accounts).toHaveLength(accounts.length - 1);

    await s.finance(adminId).upsertAccount({ id: "eb-1", connectionId: null, provider: "enablebanking", externalId: "x", identity: "x", name: "Nordea", iban: null, currency: "EUR", type: "checking" });
    expect(await admin.call("DELETE", "/api/accounts/eb-1")).toMatchObject({ status: 400, body: { error: "Pankkiyhteyden tiliä ei voi poistaa." } });
    expect(await s.finance(adminId).getAccount("eb-1")).not.toBeNull();
  });
});

describe("account type", () => {
  it("can be set to a known type; an unknown one is refused", async () => {
    const { admin, s } = await setupApp();
    const { accountId } = (await seedCsv(s, admin, { content: checkingCsv, accountName: "Käyttötili" })).body;
    for (const type of ["checking", "savings", "credit_card", "loan", "other"]) {
      expect((await admin.call("PATCH", `/api/accounts/${accountId}`, { type })).body.type, type).toBe(type);
    }
    expect(await admin.call("PATCH", `/api/accounts/${accountId}`, { type: "räjähde" })).toMatchObject({ status: 400, body: { error: "Tuntematon tilityyppi." } });
  });
});

describe("account name", () => {
  it("is the user's own, stored apart from the original; an empty one or the original brings it back", async () => {
    const { admin, s } = await setupApp();
    const { accountId } = (await seedCsv(s, admin, { content: checkingCsv, accountName: "Käyttötili" })).body;
    const account = async () => (await admin.call("GET", "/api/meta")).body.accounts.find((a: { id: string }) => a.id === accountId);
    expect(await account()).toMatchObject({ name: "Käyttötili", bankName: "Käyttötili", customName: null });

    expect((await admin.call("PATCH", `/api/accounts/${accountId}`, { name: "  Yhteinen tili " })).body).toMatchObject({ name: "Yhteinen tili", bankName: "Käyttötili", customName: "Yhteinen tili" });
    // a type edit leaves the name alone
    expect((await admin.call("PATCH", `/api/accounts/${accountId}`, { type: "savings" })).body).toMatchObject({ name: "Yhteinen tili", type: "savings" });
    expect((await admin.call("PATCH", `/api/accounts/${accountId}`, { name: "Käyttötili" })).body).toMatchObject({ name: "Käyttötili", customName: null });
    await admin.call("PATCH", `/api/accounts/${accountId}`, { name: "Toinen" });
    expect((await admin.call("PATCH", `/api/accounts/${accountId}`, { name: "   " })).body).toMatchObject({ name: "Käyttötili", customName: null });
    expect((await account()).customName).toBeNull();
  });

  it("is only the owner's to change", async () => {
    const { admin, s, member } = await setupApp();
    const { accountId } = (await seedCsv(s, admin, { content: checkingCsv, accountName: "Käyttötili" })).body;
    const eero = await member("eero");
    expect((await eero.call("PATCH", `/api/accounts/${accountId}`, { name: "Minun" })).status).toBe(404);
    expect((await admin.call("GET", "/api/meta")).body.accounts.find((a: { id: string }) => a.id === accountId).customName).toBeNull();
  });
});

describe("what the bank says about an account (made-up holders and IBANs)", () => {
  it.each([
    [{ uid: "1", name: "Testi Esimerkki", product: "Käyttötili" }, "Käyttötili"],
    [{ uid: "2", name: "Testi Esimerkki;Maija Mallikas", cash_account_type: "CACC" }, "Testi Esimerkki, Maija Mallikas"],
    [{ uid: "3", name: "Testi Esimerkki", product: " ASP-tili " }, "ASP-tili"],
    [{ uid: "4", details: "Lomatili", account_id: { iban: "FI7412345600000801" } }, "Lomatili"],
    [{ uid: "5", account_id: { iban: "FI7412345600000801" } }, "FI7412345600000801"],
    [{ uid: "6" }, "Tili"],
  ])("%j is named %s", (account, name) => expect(accountName(account as never)).toBe(name));

  it("keeps the holder or holders apart from the name", () => {
    expect(accountHolder({ uid: "1", name: "Testi Esimerkki;Maija Mallikas" })).toBe("Testi Esimerkki, Maija Mallikas");
    expect(accountHolder({ uid: "1", name: " ; " })).toBeNull();
    expect(accountHolder({ uid: "1" })).toBeNull();
  });

  it.each([
    ["Käyttötili", "checking"],
    ["Nordea Premium", "checking"],
    ["Säästötili", "savings"],
    ["Pikasäästö", "savings"],
    ["ASP-tili", "savings"],
    ["Tuottotili", "savings"],
    ["Sijoitustili", "savings"],
  ])("a CACC account with the product %s reads %s", (product, type) => expect(accountType({ uid: "1", name: "Testi Esimerkki", product, cash_account_type: "CACC" })).toBe(type));

  it("takes a savings word from the product or the description, never from the holder's name", () => {
    expect(accountType({ uid: "1", name: "Säästäväinen Esimerkki", product: "Käyttötili", cash_account_type: "CACC" })).toBe("checking");
    expect(accountType({ uid: "1", details: "Lomasäästöt", cash_account_type: "CACC" })).toBe("savings");
    // the bank's own code still wins over the product text
    expect(accountType({ uid: "1", product: "Säästötili", cash_account_type: "CARD" })).toBe("credit_card");
    expect(accountType({ uid: "1", product: "Käyttötili", cash_account_type: "SVGS" })).toBe("savings");
  });

  it("keeps only the last four digits of a card, wherever the bank puts the number", () => {
    expect(cardMask({ uid: "1", account_id: { other: { identification: "5225********1144", scheme_name: "CPAN" } } })).toBe("•••• 1144");
    expect(cardMask({ uid: "1", all_account_ids: [{ identification: "5225********7788", scheme_name: "CPAN" }] })).toBe("•••• 7788");
    expect(cardMask({ uid: "1", account_id: { other: { identification: "5225123412341144", scheme_name: "CPAN" } } })).toBe("•••• 1144");
    expect(cardMask({ uid: "1", account_id: { iban: "FI7412345600000801" } })).toBeNull();
    expect(cardMask({ uid: "1", account_id: { other: { identification: "**", scheme_name: "CPAN" } } })).toBeNull();
  });

  it("reads a positive credit limit in euros and nothing else", () => {
    expect(creditLimitCents({ uid: "1", credit_limit: { currency: "EUR", amount: "2000.00" } })).toBe(200000);
    expect(creditLimitCents({ uid: "1", credit_limit: { currency: "EUR", amount: "0.00" } })).toBeNull();
    expect(creditLimitCents({ uid: "1", credit_limit: { currency: "SEK", amount: "2000.00" } })).toBeNull();
    expect(creditLimitCents({ uid: "1", credit_limit: { currency: "EUR", amount: "paljon" } })).toBeNull();
    expect(creditLimitCents({ uid: "1" })).toBeNull();
  });
});
