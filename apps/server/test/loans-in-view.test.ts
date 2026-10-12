/**
 * The typed loans of a view (services/loans-in-view.ts). A loan one member typed in and pays from a joint account is in
 * the own view of every user of that account, at their part, and the parts add up to the loan. The household view
 * holds a loan paid from any of its accounts whole, whoever typed it in, and a loan two members typed in counts once.
 * A loan with no payments linked is its typist's alone. Another member's loan says who typed it in (`typedBy`).
 *
 * A member's own view is built here as the server builds one: each account with its use and the viewer's part, its
 * balance at that part, and no account the viewer has no part of. The household's view holds every account whole and
 * tells no part. Made-up names and sums only.
 */
import { type AccountType, type AccountUse, type BalanceInput, householdDebts, type Loan, loanProposals, loansOf, type Part, partCents, type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { usesInView } from "../src/services/account-use.ts";
import { requestInputs, type ScopeAccount, sharedInView } from "../src/services/analysis.ts";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { type Client, NOW, setupApp } from "./helpers.ts";

const AINO = "MEIKALAINEN AINO";
const EERO = "KORHONEN EERO";
const LIISA = "VIRTANEN LIISA";
const LENDER = "Esimerkkirahoitus Oy";

type App = Awaited<ReturnType<typeof setupApp>>;
type Member = Client & { id: string };
type InView = ScopeAccount & { use: AccountUse; part?: Part };

// The test clock is 2026-10-09.
const mortgage = { name: "Asuntolaina", lender: "ESIMERKKIRAHOITUS OY", kind: "mortgage", balanceCents: 14_999_999, balanceDate: "2026-10-05", rateBp: 325, repayment: "annuity", intervalMonths: 1, paymentCents: 84_001 };
const flex = { name: "Joustoluotto", kind: "credit_line", balanceCents: 50_001, balanceDate: "2026-10-05" };
/** The key of the payments' series on an account, as a proposal gives it. */
const keyOn = (accountId: string, cents = 84_001) => `out:${accountId}:${LENDER}#${cents}`;
/** A loan as a view holds it for another member: who typed it in, and the view's own names for its accounts. */
const typedBy = (name: string, loan: Loan, seriesKey: string): Loan => ({ ...loan, typedBy: name, seriesKey });

/** An account as a link stores one. `identity` is the real account: both partners' copies of a joint account carry the same. */
async function link(s: App["s"], userId: string, id: string, holder: string, identity: string, type: AccountType = "checking", balanceCents?: number) {
  const repo = s.finance(userId);
  await repo.upsertAccount({ id, connectionId: null, provider: "csv", externalId: null, identity, name: id, holder, iban: null, currency: "EUR", type });
  if (balanceCents !== undefined) await repo.setAccountBalance(id, balanceCents, NOW.toISOString());
}

/** Aino, Eero and Liisa, each with an account in their own name, and a joint account Aino and Eero both linked. */
async function household() {
  const app = await setupApp();
  const aino: Member = Object.assign(app.admin, { id: app.adminId });
  const eero: Member = await app.member("eero", "Eero");
  const liisa: Member = await app.member("liisa", "Liisa");
  await link(app.s, aino.id, "aino-own", AINO, "idn-aino-own");
  await link(app.s, eero.id, "eero-own", EERO, "idn-eero-own");
  await link(app.s, liisa.id, "liisa-own", LIISA, "idn-liisa-own");
  await link(app.s, aino.id, "aino-joint", `${AINO}, ${EERO}`, "idn-joint");
  await link(app.s, eero.id, "eero-joint", `${EERO}, ${AINO}`, "idn-joint");
  return { ...app, aino, eero, liisa };
}

async function save(member: Member, loan: object): Promise<Loan> {
  const res = await member.call("POST", "/api/loans", loan);
  expect(res.body.error, JSON.stringify(loan)).toBeUndefined();
  return res.body.loan;
}

/** Says who uses an account. A user of null is the holders who are no user of the instance. */
const say = async (member: Member, accountId: string, users: [Member | null, number][]) =>
  expect((await member.call("PUT", `/api/accounts/${accountId}/use`, { users: users.map(([user, weight]) => ({ userId: user?.id ?? null, weight })) })).body).toEqual({ ok: true });

/** Every account a member may see, their own and the ones shared with them, each with its use and the member's part of it. */
async function seenBy(s: App["s"], userId: string) {
  const mine = await s.finance(userId).listAccounts();
  const seen: ScopeAccount[] = [...mine.map((a) => ({ ...a, ownerName: null })), ...(await sharedInView(s, userId, mine))];
  const uses = await usesInView(s, userId, seen);
  return seen.map((a) => ({ ...a, ...uses.get(a.id)! }));
}

/** A member's view: its accounts, the loans the request reads for it, and the debts core tells of them. */
async function viewOf(s: App["s"], userId: string, scope: "own" | "household" = "own") {
  const told = await seenBy(s, userId);
  const accounts: InView[] = scope === "household" ? told.map(({ part: _part, ...a }) => a) : told.filter((a) => a.part.to > a.part.from);
  const { inputs } = await requestInputs(s, userId, accounts);
  const counted = (cents: number | null, part: Part | undefined) => (cents === null || !part ? cents : partCents(cents, part));
  const balances = accounts.map((a): BalanceInput => ({
    id: a.id, name: a.name, type: a.type, balanceCents: counted(a.balanceCents, a.part), ownerName: a.ownerName, balanceAt: null,
    creditLimitCents: counted(a.creditLimitCents, a.part), use: a.use, ...(a.part ? { part: a.part } : {}),
  }));
  const partOn = (identity: string) => accounts.find((a) => a.identity === identity)!.part!;
  return { accounts: accounts.map((a) => a.id).sort(), partOn, inputs, loans: loansOf(inputs), debts: householdDebts(balances, inputs, s.today()) };
}

describe("a typed loan paid from a joint account", () => {
  it("is in the own view of each user of the account at their part, and the two parts are the loan", async () => {
    const { s, aino, eero, liisa } = await household();
    const loan = await save(aino, { ...mortgage, seriesKey: keyOn("aino-joint"), rateReviewDate: "2027-03-14" });
    const [all, hers, his] = [await viewOf(s, aino.id, "household"), await viewOf(s, aino.id), await viewOf(s, eero.id)];
    const whole = all.debts.total.cents;
    expect(whole).toBe(14_999_999);
    expect([hers, his].map((v) => v.debts.total.cents)).toEqual([hers, his].map((v) => partCents(whole, v.partOn("idn-joint"))));
    expect([hers.debts.total.cents, his.debts.total.cents].sort()).toEqual([7_499_999, 7_500_000]);
    expect(all.debts.interest.cents).toBeGreaterThan(400_000);
    expect(hers.debts.interest.cents + his.debts.interest.cents).toBe(all.debts.interest.cents);
    // his view names the payments' account by his own copy of it, so the loan follows that copy's part
    expect(hers.loans).toEqual([loan]);
    expect(his.loans).toEqual([typedBy("Aino", loan, keyOn("eero-joint"))]);
    // the terms travel with the loan, the review day of its rate too
    expect(loan.rateReviewDate).toBe("2027-03-14");
    expect(his.loans[0]!.rateReviewDate).toBe("2027-03-14");
    expect([...his.debts.parts]).toEqual([[loan.id, his.partOn("idn-joint")]]);
    // the household view holds the loan whole, hers as her own and his by his copy of the account
    expect(all.loans).toEqual([loan]);
    expect(all.debts.parts.size).toBe(0);
    expect((await viewOf(s, eero.id, "household")).loans).toEqual([typedBy("Aino", loan, keyOn("eero-joint"))]);
    // a member who uses no account with her has nothing of it
    expect((await viewOf(s, liisa.id)).loans).toEqual([]);
  });

  it("follows a use the household said, and reaches a third user once that user sees the account", async () => {
    const { s, aino, eero, liisa } = await household();
    const loan = await save(aino, { ...mortgage, seriesKey: keyOn("aino-joint") });
    await say(aino, "aino-joint", [[aino, 60_000], [eero, 40_000]]);
    const [hers, his] = [await viewOf(s, aino.id), await viewOf(s, eero.id)];
    expect(hers.debts.total.cents + his.debts.total.cents).toBe(14_999_999);
    // three fifths and two fifths of 14 999 999, a cent to one of them
    expect(hers.debts.total.cents).toBe(partCents(14_999_999, hers.partOn("idn-joint")));
    expect(Math.abs(hers.debts.total.cents - 8_999_999.4)).toBeLessThan(1);
    expect(Math.abs(his.debts.total.cents - 5_999_999.6)).toBeLessThan(1);

    await say(eero, "eero-joint", [[aino, 1], [eero, 1], [liisa, 1]]);
    // near miss: a part of an account she cannot see is in no view of hers
    expect((await viewOf(s, liisa.id)).loans).toEqual([]);
    expect((await aino.call("PUT", `/api/accounts/aino-joint/shares/${liisa.id}`)).status).toBe(200);
    const three = [await viewOf(s, aino.id), await viewOf(s, eero.id), await viewOf(s, liisa.id)];
    expect(three.map((v) => v.debts.total.cents).sort()).toEqual([4_999_999, 5_000_000, 5_000_000]);
    expect(three.reduce((cents, v) => cents + v.debts.interest.cents, 0)).toBe((await viewOf(s, aino.id, "household")).debts.interest.cents);
    // she sees Aino's copy of the account: the key names it already
    expect(three[2]!.accounts).toEqual(["aino-joint", "liisa-own"]);
    expect(three[2]!.loans).toEqual([typedBy("Aino", loan, keyOn("aino-joint"))]);
  });

  it("leaves the part of a holder who is no user of the instance in nobody's view", async () => {
    const { s, aino, eero } = await household();
    await save(aino, { ...mortgage, seriesKey: keyOn("aino-joint") });
    await say(aino, "aino-joint", [[aino, 1], [eero, 1], [null, 1]]);
    const [hers, his] = [await viewOf(s, aino.id), await viewOf(s, eero.id)];
    // the thirds of 14 999 999 are 5 000 000, 4 999 999 and 5 000 000 in the order of the parts, the outside holder's last
    expect([hers.debts.total.cents, his.debts.total.cents].sort()).toEqual([4_999_999, 5_000_000]);
    expect(hers.debts.total.cents + his.debts.total.cents).toBe(14_999_999 - partCents(14_999_999, { from: 2, to: 3, of: 3 }));
  });

  it("stays its typist's alone when the account is one person's, when no payments leave an account, and when the typist is no user of it", async () => {
    const { s, aino, eero, liisa } = await household();
    await link(s, eero.id, "eero-second", `${EERO}, ${LIISA}`, "idn-second");
    await link(s, liisa.id, "liisa-second", `${LIISA}, ${EERO}`, "idn-second");
    const own = await save(eero, flex);
    const paid = await save(aino, { ...mortgage, seriesKey: keyOn("aino-joint") });
    // hers alone: paid from her own account, typed with no payments, money in, and a key that names no series
    const alone: Loan[] = [];
    for (const seriesKey of [keyOn("aino-own"), null, `in:aino-joint:${LENDER}#84001`, LENDER]) alone.push(await save(aino, { ...flex, seriesKey }));
    // her own account stays hers when he may see it
    expect((await aino.call("PUT", `/api/accounts/aino-own/shares/${eero.id}`)).status).toBe(200);
    const inHis = typedBy("Aino", paid, keyOn("eero-joint"));
    const his = await viewOf(s, eero.id);
    expect(his.accounts).toEqual(["eero-joint", "eero-own", "eero-second"]);
    // his own loans first, then hers
    expect(his.loans).toEqual([own, inHis]);
    // an account he sees and has no part of gives him nothing, also when a view holds it at nothing
    const seen = await seenBy(s, eero.id);
    expect(seen.find((a) => a.id === "aino-own")!.part).toEqual({ from: 0, to: 0, of: 1 });
    expect(loansOf((await requestInputs(s, eero.id, seen)).inputs)).toEqual([own, inHis]);
    expect((await viewOf(s, aino.id)).loans).toEqual([paid, ...alone]);

    // Liisa uses the second account with him and is no user of the first: her loan on the first is hers alone
    const stranger = await save(liisa, { ...flex, seriesKey: keyOn("aino-joint") });
    expect((await viewOf(s, eero.id)).loans).toEqual([own, inHis]);
    expect((await viewOf(s, liisa.id)).loans).toEqual([stranger]);
    // near miss: her loan paid from the account the two of them use is in his view
    const theirs = await save(liisa, { ...flex, seriesKey: keyOn("liisa-second", 5_000) });
    const both = (await viewOf(s, eero.id)).loans;
    expect(both).toHaveLength(3);
    expect(both[0]).toEqual(own);
    // the other users' loans follow typist by typist, in the order of the typists' ids
    expect(both.slice(1)).toEqual(expect.arrayContaining([inHis, typedBy("Liisa", theirs, keyOn("eero-second", 5_000))]));
    expect((await viewOf(s, aino.id)).loans).toEqual([paid, ...alone]);

    // the joint account said to be his alone: her loan is hers alone and whole, his view has none of it
    await say(eero, "eero-joint", [[eero, 1]]);
    expect((await viewOf(s, eero.id)).loans.map((l) => l.id)).toEqual([own.id, theirs.id]);
    const hers = await viewOf(s, aino.id);
    expect(hers.accounts).toEqual(["aino-own"]);
    expect(hers.loans).toEqual([paid, ...alone]);
    expect(hers.debts.parts.size).toBe(0);
    // and said to be hers alone, with him at nothing
    await say(aino, "aino-joint", [[aino, 1], [eero, 0]]);
    expect((await viewOf(s, eero.id)).loans.map((l) => l.id)).toEqual([own.id, theirs.id]);
    // she weighs nothing on an account he uses with a holder who is no user: she is no user of it, and her loan is hers alone
    await say(aino, "aino-joint", [[aino, 0], [eero, 1], [null, 1]]);
    const last = await viewOf(s, eero.id);
    expect(last.partOn("idn-joint")).toEqual({ from: 0, to: 1, of: 2 });
    expect(last.loans.map((l) => l.id)).toEqual([own.id, theirs.id]);
  });

  it("a loan linked to a connected account is one debt in each own view, and no account outside the view is named", async () => {
    const { s, aino, eero } = await household();
    await link(s, aino.id, "aino-loan", `${AINO}, ${EERO}`, "idn-loan", "loan", -9_000_001);
    await link(s, eero.id, "eero-loan", `${EERO}, ${AINO}`, "idn-loan", "loan", -9_000_001);
    // a second loan account of the two, which she alone linked: he cannot see it
    await link(s, aino.id, "aino-car", `${AINO}, ${EERO}`, "idn-car", "loan", -500_001);
    const home = await save(aino, { name: "Asuntolaina", kind: "mortgage", balanceCents: 9_100_000, balanceDate: "2026-10-05", seriesKey: keyOn("aino-joint"), accountId: "aino-loan" });
    const car = await save(aino, { name: "Autolaina", kind: "car", balanceCents: 500_001, balanceDate: "2026-10-05", seriesKey: keyOn("aino-joint", 25_000), accountId: "aino-car" });
    const [all, hers, his] = [await viewOf(s, aino.id, "household"), await viewOf(s, aino.id), await viewOf(s, eero.id)];
    expect(his.accounts).toEqual(["eero-joint", "eero-loan", "eero-own"]);
    const { accountId: _hers, ...unlinked } = car;
    expect(his.loans).toEqual([{ ...typedBy("Aino", home, keyOn("eero-joint")), accountId: "eero-loan" }, typedBy("Aino", unlinked, keyOn("eero-joint", 25_000))]);
    expect(his.loans[1]).not.toHaveProperty("accountId");
    // the mortgage is his copy's debt once, at his part of the bank's balance; the car loan counts as typed, at his part
    expect(his.debts.connected.map((d) => d.id)).toEqual([home.id]);
    expect(his.debts.saved.map((d) => d.id)).toEqual([car.id]);
    expect(his.debts.total.cents).toBe(partCents(9_000_001, his.partOn("idn-loan")) + partCents(500_001, his.partOn("idn-joint")));
    expect(hers.debts.connected.map((d) => d.id)).toEqual([home.id, car.id]);
    expect(all.debts.total.cents).toBe(9_000_001 + 500_001);
    expect(hers.debts.total.cents + his.debts.total.cents).toBe(all.debts.total.cents);
  });
});

describe("a loan proposal beside a loan another user saved", () => {
  const raw = (bookingDate: string, euros: number, counterparty: string, description: string): RawTransaction => ({
    externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
    counterparty, counterpartyIban: null, description, reference: null, mcc: null,
  });
  /** A made-up lender debiting 250 € on the 5th of every month from April to October 2026, and a salary. */
  const rows = [4, 5, 6, 7, 8, 9, 10].flatMap((month) => {
    const m = String(month).padStart(2, "0");
    return [raw(`2026-${m}-05`, -250, "ESIMERKKIRAHOITUS OY", "LAINAN LYHENNYS"), raw(`2026-${m}-15`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA")];
  });

  it("is not made to the other user of the joint account, and comes back when the loan is removed", async () => {
    const { s, aino, eero } = await household();
    for (const [member, accountId] of [[aino, "aino-joint"], [eero, "eero-joint"]] as const) {
      const repo = s.finance(member.id);
      await ingestTransactions(repo, accountId, rows, "csv");
      await reprocess(repo, s.settings);
    }
    const proposals = async (member: Member) => loanProposals((await s.analysis.get(s, member.id, "own")).ctx, (await viewOf(s, member.id)).inputs);
    const [hers, his] = [await proposals(aino), await proposals(eero)];
    expect([hers, his].map((p) => p.map((x) => x.key))).toEqual([[keyOn("aino-joint", 25_000)], [keyOn("eero-joint", 25_000)]]);
    const loan = await save(aino, { name: "Kulutusluotto", kind: "consumer", balanceCents: 900_000, balanceDate: "2026-10-05", paymentCents: 25_000, intervalMonths: 1, seriesKey: hers[0]!.key });
    expect(await proposals(aino)).toEqual([]);
    // the key of her loan in his view is the key his own proposal had
    expect((await viewOf(s, eero.id)).loans).toEqual([typedBy("Aino", loan, his[0]!.key)]);
    expect(await proposals(eero)).toEqual([]);
    expect((await aino.call("DELETE", `/api/loans/${loan.id}`)).status).toBe(200);
    expect((await proposals(eero)).map((p) => p.key)).toEqual([his[0]!.key]);
  });
});

describe("the household view and a loan another member typed in", () => {
  const share = async (owner: Member, accountId: string, other: Member) => expect((await owner.call("PUT", `/api/accounts/${accountId}/shares/${other.id}`)).status).toBe(200);

  /** What a member's pages tell of the debts in a view, read as the browser reads them. */
  async function told(member: Member, scope: "own" | "household") {
    const [dash, reports] = [await member.call("GET", `/api/dashboard?scope=${scope}`), await member.call("GET", `/api/reports?scope=${scope}&reports=loans`)];
    expect([dash.status, reports.status]).toEqual([200, 200]);
    const rows: { leftCents: number | null; typedBy?: string }[] = dash.body.holdings.loans;
    const listed: { typedBy?: string }[] = reports.body.loans.loans;
    return {
      debtCents: dash.body.holdings.debtCents, left: rows.map((l) => l.leftCents), typedBy: rows.map((l) => l.typedBy ?? null),
      total: reports.body.loans.total.cents, listedBy: listed.map((l) => l.typedBy ?? null), text: JSON.stringify([dash.body, reports.body]),
    };
  }

  it("each member's household view owes what the two own views owe together, whoever typed the loan in", async () => {
    const { s, aino, eero } = await household();
    await link(s, aino.id, "aino-card", AINO, "idn-aino-card", "credit_card", -8_075);
    await share(aino, "aino-own", eero);
    await share(aino, "aino-card", eero);
    await share(eero, "eero-own", aino);
    await say(aino, "aino-joint", [[aino, 60_000], [eero, 40_000]]);
    const loan = await save(aino, { ...mortgage, seriesKey: keyOn("aino-joint") });
    const views = [await told(aino, "own"), await told(eero, "own"), await told(aino, "household"), await told(eero, "household")];
    // three fifths and two fifths of 149 999,99, and her card of 80,75 that he has no part of
    expect(views.map((v) => v.left)).toEqual([[8_999_999], [6_000_000], [14_999_999], [14_999_999]]);
    expect(views.map((v) => v.debtCents)).toEqual([9_008_074, 6_000_000, 15_008_074, 15_008_074]);
    expect(views.map((v) => v.total)).toEqual(views.map((v) => v.debtCents));
    // his rows say who typed the loan in, hers say nothing (the report lists the card too, after the loan)
    expect(views.map((v) => v.typedBy)).toEqual([[null], ["Aino"], [null], ["Aino"]]);
    expect(views.map((v) => v.listedBy)).toEqual([[null, null], ["Aino"], [null, null], ["Aino", null]]);
    // his answers name the paying account by his own copy, never by hers
    for (const his of [views[1]!, views[3]!]) expect(his.text).not.toContain("aino-joint");
    // the loan stays hers to list, change and remove
    expect((await eero.call("GET", "/api/loans")).body.loans).toEqual([]);
    expect((await eero.call("PUT", `/api/loans/${loan.id}`, { ...mortgage, name: "Kaapattu" })).status).toBe(404);
    expect((await eero.call("DELETE", `/api/loans/${loan.id}`)).status).toBe(404);
    expect((await aino.call("GET", "/api/loans")).body.loans).toEqual([loan]);
  });

  it("a loan both members typed in is one debt in every view, the viewer's own, and two of the viewer's own both stay", async () => {
    const { s, aino, eero, liisa } = await household();
    const hers = await save(aino, { ...mortgage, seriesKey: keyOn("aino-joint") });
    // he typed the same loan from his bank's papers, a cent apart, paid by the same series on his copy of the account
    const his = await save(eero, { ...mortgage, balanceCents: 15_000_000, seriesKey: keyOn("eero-joint") });
    for (const [member, loan] of [[aino, hers], [eero, his]] as const) {
      const [own, all] = [await viewOf(s, member.id), await viewOf(s, member.id, "household")];
      expect([own.loans, all.loans]).toEqual([[loan], [loan]]);
      expect([own.debts.total.cents, all.debts.total.cents]).toEqual([partCents(loan.balanceCents, own.partOn("idn-joint")), loan.balanceCents]);
    }
    // near miss: his loan paid by another series of the same account is another debt, in both of her views
    const car = await save(eero, { ...flex, seriesKey: keyOn("eero-joint", 25_000) });
    const hisCar = typedBy("Eero", car, keyOn("aino-joint", 25_000));
    expect([(await viewOf(s, aino.id)).loans, (await viewOf(s, aino.id, "household")).loans]).toEqual([[hers, hisCar], [hers, hisCar]]);

    // a third user of the account typed in neither: her views hold the mortgage once, the one of the first typist by id
    await say(aino, "aino-joint", [[aino, 1], [eero, 1], [liisa, 1]]);
    await share(aino, "aino-joint", liisa);
    const first = aino.id < eero.id ? typedBy("Aino", hers, keyOn("aino-joint")) : typedBy("Eero", his, keyOn("aino-joint"));
    for (const scope of ["own", "household"] as const) {
      const third = (await viewOf(s, liisa.id, scope)).loans;
      expect(third).toHaveLength(2);
      expect(third).toEqual(expect.arrayContaining([first, hisCar]));
    }
    // two loans of her own on one series are hers to sort out: both stay, and his view keeps his own row alone
    const again = await save(aino, { ...flex, seriesKey: keyOn("aino-joint") });
    expect((await viewOf(s, aino.id)).loans).toEqual([hers, again, hisCar]);
    expect((await viewOf(s, eero.id, "household")).loans).toEqual([his, car]);
  });

  it("holds nothing of a loan paid from an account outside it, of one with no payments linked and of one a stranger to the account typed in", async () => {
    const { s, aino, eero, liisa } = await household();
    const paid = await save(aino, { ...mortgage, seriesKey: keyOn("aino-own") });
    const bare = await save(aino, flex);
    // Liisa, of another household, names their joint account in a key: she linked no copy of it and no use names her
    const forged = await save(liisa, { ...flex, seriesKey: keyOn("aino-joint") });
    expect((await viewOf(s, eero.id, "household")).loans).toEqual([]);
    expect((await viewOf(s, aino.id, "household")).loans).toEqual([paid, bare]);
    expect((await viewOf(s, liisa.id, "household")).loans).toEqual([forged]);

    // near miss: once she shares the account the payments leave, his household view holds the loan whole and his own view none of it
    await share(aino, "aino-own", eero);
    const his = await viewOf(s, eero.id, "household");
    expect(his.accounts).toEqual(["aino-own", "eero-joint", "eero-own"]);
    expect(his.loans).toEqual([typedBy("Aino", paid, keyOn("aino-own"))]);
    expect([his.debts.total.cents, his.debts.parts.size]).toEqual([14_999_999, 0]);
    expect((await viewOf(s, eero.id)).loans).toEqual([]);
    // near miss: a member the account's use names has a tie to it at any weight, so her loan is in the views that hold the account whole
    await say(aino, "aino-joint", [[aino, 1], [eero, 1], [liisa, 0]]);
    const named = (await viewOf(s, eero.id, "household")).loans;
    expect(named).toHaveLength(2);
    expect(named).toEqual(expect.arrayContaining([typedBy("Aino", paid, keyOn("aino-own")), typedBy("Liisa", forged, keyOn("eero-joint"))]));
    expect((await viewOf(s, eero.id)).loans).toEqual([]);
    // and so has a member who linked a copy of the account, when the use names another alone: her loan is in, the stranger's is out again
    await say(eero, "eero-joint", [[eero, 1]]);
    const joint = await save(aino, { ...flex, seriesKey: keyOn("aino-joint") });
    expect((await viewOf(s, eero.id, "household")).loans).toEqual([typedBy("Aino", paid, keyOn("aino-own")), typedBy("Aino", joint, keyOn("eero-joint"))]);
    expect((await viewOf(s, eero.id)).loans).toEqual([]);
  });

  it("counts another member's loan linked to a loan account once, by the account's balance, when the view holds that account", async () => {
    const { s, aino, eero } = await household();
    await link(s, aino.id, "aino-loan", AINO, "idn-loan", "loan", -9_000_001);
    const home = await save(aino, { name: "Asuntolaina", kind: "mortgage", balanceCents: 9_100_000, balanceDate: "2026-10-05", seriesKey: keyOn("aino-joint"), accountId: "aino-loan" });
    // he cannot see her loan account: the loan counts as typed, and names no account of hers
    const { accountId: _hers, ...unlinked } = home;
    const before = await viewOf(s, eero.id, "household");
    expect(before.loans).toEqual([typedBy("Aino", unlinked, keyOn("eero-joint"))]);
    expect(before.loans[0]).not.toHaveProperty("accountId");
    expect(before.debts.total.cents).toBe(9_100_000);
    await share(aino, "aino-loan", eero);
    const after = await viewOf(s, eero.id, "household");
    expect(after.loans).toEqual([typedBy("Aino", home, keyOn("eero-joint"))]);
    expect(after.debts.connected.map((d) => [d.id, d.typedBy])).toEqual([[home.id, "Aino"]]);
    expect([after.debts.saved.length, after.debts.total.cents]).toEqual([0, 9_000_001]);
  });
});
