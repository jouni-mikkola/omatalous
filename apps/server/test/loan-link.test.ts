/**
 * A saved loan names the connected account that is the same debt (migration 0016, routes/loans.ts). The link is the
 * user's own to make: to an own card or loan account only, one loan to an account, and it goes when the account goes.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AccountType } from "@banking/core";
import { describe, expect, it } from "vitest";
import { foldCsvAccounts } from "../src/connectors/fold-accounts.ts";
import { FinanceRepo } from "../src/db/finance-repo.ts";
import { openDatabase } from "../src/db/open.ts";
import { loadFixture } from "./fixture-db.ts";
import { setupApp } from "./helpers.ts";

const NOT_LINKABLE = "Lainan voi liittää vain omaan luottokortti- tai lainatiliin.";
const HELD = "Tähän tiliin on jo liitetty laina Korttiluotto. Poista liitos siitä ensin.";

// The test clock is 2026-10-09. The lender is made up.
const card = { name: "Korttiluotto", lender: "ESIMERKKIRAHOITUS OY", kind: "card", balanceCents: 123_456, balanceDate: "2026-10-05", limitCents: 500_000 };
const flex = { name: "Joustoluotto", lender: "ESIMERKKIRAHOITUS OY", kind: "credit_line", balanceCents: 50_000, balanceDate: "2026-10-05" };

/**
 * Aino with a card, a loan and a current account, and Eero with a card of his own. The accounts came from a file: the
 * route that removes an account takes those.
 */
async function household() {
  const app = await setupApp();
  const eero = await app.member("eero");
  const account = (userId: string, id: string, type: AccountType) =>
    app.s.finance(userId).upsertAccount({ id, connectionId: null, provider: "csv", externalId: null, identity: null, name: id, iban: null, currency: "EUR", type });
  await account(app.adminId, "a-card", "credit_card");
  await account(app.adminId, "a-loan", "loan");
  await account(app.adminId, "a-checking", "checking");
  await account(eero.id, "e-card", "credit_card");
  const linkOf = async (loanId: string) => (await app.db.first<{ account_id: string | null }>("SELECT account_id FROM loans WHERE id = ?", [loanId]))?.account_id;
  return { ...app, eero, linkOf };
}

describe("a loan's connected account", () => {
  it("saves a link to the user's own card or loan account and reads it back; a loan without one has no field", async () => {
    const { admin, linkOf } = await household();
    const onCard = await admin.call("POST", "/api/loans", { ...card, accountId: "a-card" });
    expect(onCard.status).toBe(200);
    expect(onCard.body.loan).toMatchObject({ ...card, accountId: "a-card" });
    const onLoan = await admin.call("POST", "/api/loans", { ...flex, accountId: "a-loan" });
    expect(onLoan.body.loan.accountId).toBe("a-loan");
    const plain = await admin.call("POST", "/api/loans", { ...flex, name: "Opintolaina" });
    expect(plain.status).toBe(200);
    expect(plain.body.loan).not.toHaveProperty("accountId");

    const loans = (await admin.call("GET", "/api/loans")).body.loans;
    expect(loans).toEqual([onCard.body.loan, onLoan.body.loan, plain.body.loan]);
    expect(loans[2]).not.toHaveProperty("accountId");
    expect([await linkOf(onCard.body.loan.id), await linkOf(onLoan.body.loan.id), await linkOf(plain.body.loan.id)]).toEqual(["a-card", "a-loan", null]);
  });

  it("answers one sentence for another member's account, an id nobody has and a current account", async () => {
    const { admin, eero, s, adminId, db } = await household();
    const id: string = (await admin.call("POST", "/api/loans", card)).body.loan.id;
    // sharing an account does not make it the viewer's to link
    expect(await s.household.share(eero.id, "e-card", adminId)).toBe(true);

    for (const accountId of ["e-card", "no-such-account", "a-checking", "", "x".repeat(201), 12, true, {}]) {
      const tried = JSON.stringify(accountId).slice(0, 30);
      expect(await admin.call("POST", "/api/loans", { ...card, accountId }), `POST ${tried}`).toMatchObject({ status: 400, body: { error: NOT_LINKABLE } });
      expect(await admin.call("PUT", `/api/loans/${id}`, { ...card, accountId }), `PUT ${tried}`).toMatchObject({ status: 400, body: { error: NOT_LINKABLE } });
    }
    // nothing of the refused requests was saved
    expect(await db.all("SELECT account_id FROM loans")).toEqual([{ account_id: null }]);
    // the card is Eero's to link: what was refused above is whose it is
    expect((await eero.call("POST", "/api/loans", { ...card, accountId: "e-card" })).body.loan.accountId).toBe("e-card");
  });

  it("removes the link when the field is null or left out", async () => {
    const { admin, linkOf } = await household();
    const id: string = (await admin.call("POST", "/api/loans", { ...card, accountId: "a-card" })).body.loan.id;
    expect(await linkOf(id)).toBe("a-card");

    const nulled = await admin.call("PUT", `/api/loans/${id}`, { ...card, accountId: null });
    expect(nulled.status).toBe(200);
    expect(nulled.body.loan).not.toHaveProperty("accountId");
    expect(await linkOf(id)).toBeNull();

    expect((await admin.call("PUT", `/api/loans/${id}`, { ...card, accountId: "a-card" })).body.loan.accountId).toBe("a-card");
    const leftOut = await admin.call("PUT", `/api/loans/${id}`, card);
    expect(leftOut.status).toBe(200);
    expect(leftOut.body.loan).toEqual({ id, ...card, grantedCents: null, rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, seriesKey: null });
    expect(await linkOf(id)).toBeNull();

    const added = await admin.call("POST", "/api/loans", { ...flex, accountId: null });
    expect(added.status).toBe(200);
    expect(await linkOf(added.body.loan.id)).toBeNull();
  });

  it("refuses a second loan for an account on POST and on PUT and names the loan that holds it", async () => {
    const { admin, db, linkOf } = await household();
    const holder: string = (await admin.call("POST", "/api/loans", { ...card, accountId: "a-card" })).body.loan.id;

    expect(await admin.call("POST", "/api/loans", { ...flex, accountId: "a-card" })).toMatchObject({ status: 400, body: { error: HELD } });
    expect(await db.all("SELECT name FROM loans")).toEqual([{ name: "Korttiluotto" }]);

    const second: string = (await admin.call("POST", "/api/loans", flex)).body.loan.id;
    expect(await admin.call("PUT", `/api/loans/${second}`, { ...flex, name: "Toinen", accountId: "a-card" })).toMatchObject({ status: 400, body: { error: HELD } });
    // the refused PUT wrote none of its fields
    expect(await db.first("SELECT name, account_id FROM loans WHERE id = ?", [second])).toEqual({ name: "Joustoluotto", account_id: null });

    // the loan that holds the account is not in its own way
    const again = await admin.call("PUT", `/api/loans/${holder}`, { ...card, balanceCents: 100_000, accountId: "a-card" });
    expect(again.status).toBe(200);
    expect(again.body.loan).toMatchObject({ balanceCents: 100_000, accountId: "a-card" });
    expect(await db.first("SELECT balance_cents, account_id FROM loans WHERE id = ?", [holder])).toEqual({ balance_cents: 100_000, account_id: "a-card" });

    // a loan nobody has is a 404, whatever account it names
    expect((await admin.call("PUT", "/api/loans/no-such-loan", { ...flex, accountId: "a-card" })).status).toBe(404);

    // once the holder lets go, the account is free
    expect((await admin.call("PUT", `/api/loans/${holder}`, card)).status).toBe(200);
    expect((await admin.call("PUT", `/api/loans/${second}`, { ...flex, accountId: "a-card" })).status).toBe(200);
    expect([await linkOf(holder), await linkOf(second)]).toEqual([null, "a-card"]);
  });

  it("saves one of two requests that link one account at the same moment", async () => {
    const { admin, db } = await household();
    const answers = await Promise.all([card, flex].map((loan) => admin.call("POST", "/api/loans", { ...loan, accountId: "a-card" })));
    expect(answers.map((a) => a.status).sort()).toEqual([200, 400]);
    expect(await db.all("SELECT count(*) AS n FROM loans WHERE account_id = 'a-card'")).toEqual([{ n: 1 }]);

    // the same for two loans that are saved again at once
    const first: string = (await admin.call("POST", "/api/loans", { ...card, name: "Yksi" })).body.loan.id;
    const second: string = (await admin.call("POST", "/api/loans", { ...card, name: "Kaksi" })).body.loan.id;
    const saved = await Promise.all([first, second].map((id) => admin.call("PUT", `/api/loans/${id}`, { ...card, accountId: "a-loan" })));
    expect(saved.map((a) => a.status).sort()).toEqual([200, 400]);
    expect(await db.all("SELECT count(*) AS n FROM loans WHERE account_id = 'a-loan'")).toEqual([{ n: 1 }]);
  });

  it("names the loan saved first when a write past the routes left two loans on one account, as the totals take it", async () => {
    const { admin, db } = await household();
    await admin.call("POST", "/api/loans", { ...card, accountId: "a-card" });
    const second: string = (await admin.call("POST", "/api/loans", flex)).body.loan.id;
    // the later loan gets the account and an id that sorts first: the order of saving decides, not the id
    await db.run("UPDATE loans SET account_id = 'a-card', id = '00000000-later' WHERE id = ?", [second]);
    expect(await db.all("SELECT name FROM loans WHERE account_id = 'a-card' ORDER BY id")).toEqual([{ name: "Joustoluotto" }, { name: "Korttiluotto" }]);
    expect(await admin.call("POST", "/api/loans", { ...flex, name: "Kolmas", accountId: "a-card" })).toMatchObject({ status: 400, body: { error: HELD } });
  });

  it("leaves the loan in place, unlinked, when its account is removed", async () => {
    const { admin, linkOf } = await household();
    const loan = (await admin.call("POST", "/api/loans", { ...card, accountId: "a-card" })).body.loan;
    expect((await admin.call("DELETE", "/api/accounts/a-card")).status).toBe(200);

    const unlinked = { ...loan };
    delete unlinked.accountId;
    expect((await admin.call("GET", "/api/loans")).body.loans).toEqual([unlinked]);
    expect(await linkOf(loan.id)).toBeNull();
    // and it is saved again as any loan without a link
    expect((await admin.call("PUT", `/api/loans/${loan.id}`, card)).status).toBe(200);
  });

  /**
   * One real loan account twice: read from a file, and from the bank with the same IBAN. Linking the bank folds the
   * file account into the bank's and removes it (connectors/fold-accounts.ts).
   */
  async function sameAccountTwice() {
    const app = await household();
    const repo = app.s.finance(app.adminId);
    const both = { connectionId: null, iban: "FI2112345600000785", currency: "EUR", type: "loan" } as const;
    await repo.upsertAccount({ ...both, id: "a-file", provider: "csv", externalId: null, identity: null, name: "Laina tiedostosta" });
    await repo.upsertAccount({ ...both, id: "a-bank", provider: "enablebanking", externalId: "x", identity: "x", name: "Laina pankista" });
    return { ...app, repo };
  }

  it("carries the link to the bank's account when the file account is folded into it", async () => {
    const { admin, repo, linkOf } = await sameAccountTwice();
    const id: string = (await admin.call("POST", "/api/loans", { ...flex, accountId: "a-file" })).body.loan.id;

    expect(await foldCsvAccounts(repo)).toBe(1);
    expect(await repo.getAccount("a-file")).toBeNull();
    expect(await linkOf(id)).toBe("a-bank");
    expect((await admin.call("GET", "/api/loans")).body.loans).toMatchObject([{ id, name: "Joustoluotto", accountId: "a-bank" }]);
  });

  it("folds also when the bank's account has a loan: that loan keeps the link and the folded account's loan ends unlinked", async () => {
    const { admin, repo, linkOf } = await sameAccountTwice();
    const onFile: string = (await admin.call("POST", "/api/loans", { ...flex, accountId: "a-file" })).body.loan.id;
    const onBank: string = (await admin.call("POST", "/api/loans", { ...flex, name: "Toinen laina", accountId: "a-bank" })).body.loan.id;

    expect(await foldCsvAccounts(repo)).toBe(1);
    expect(await repo.getAccount("a-file")).toBeNull();
    expect([await linkOf(onFile), await linkOf(onBank)]).toEqual([null, "a-bank"]);
    const loans = (await admin.call("GET", "/api/loans")).body.loans;
    expect(loans.map((l: { name: string }) => l.name)).toEqual(["Joustoluotto", "Toinen laina"]);
    expect(loans[0]).not.toHaveProperty("accountId");
  });
});

describe("migration 0016 on a 0.8.7 database", () => {
  // The frozen database is named by its version. The newest fixture is written by each release with every migration
  // of that release applied, so on it 0016 would have nothing to do.
  const FIXTURE = "0.8.7.sql";

  it("keeps every loan row, and a loan saved before it reads with no link and can be given one", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "talous-loan-link-")), "data", "banking.db");
    mkdirSync(join(file, ".."), { recursive: true });
    loadFixture(file, FIXTURE);
    const old = new DatabaseSync(file, { readOnly: true });
    const before = old.prepare("SELECT * FROM loans ORDER BY id").all().map((row) => ({ ...row }));
    old.close();
    expect(before).toHaveLength(3);
    expect(before[0]).not.toHaveProperty("account_id");

    const { db } = await openDatabase(file);
    try {
      expect(await db.first("SELECT compat FROM _migrations WHERE name = '0016_loan_account.sql'")).toEqual({ compat: "0.8.0" });
      expect(await db.all("SELECT * FROM loans ORDER BY id")).toEqual(before.map((row) => ({ ...row, account_id: null })));

      const aino = new FinanceRepo(db, "u-aino");
      const loans = await aino.listLoans();
      expect(loans.map((l) => l.name)).toEqual(["Asuntolaina", "Joustoluotto"]);
      for (const loan of loans) expect(loan).not.toHaveProperty("accountId");

      // a-2 is Aino's card in the fixture
      expect(await aino.updateLoan({ ...loans[1]!, accountId: "a-2" }, "2026-10-12T09:00:00.000Z")).toBe(true);
      expect((await aino.listLoans()).map((l) => l.accountId ?? null)).toEqual([null, "a-2"]);
    } finally {
      db.close();
    }
  });
});
