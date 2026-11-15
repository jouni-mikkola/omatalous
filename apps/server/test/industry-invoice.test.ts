/**
 * What the server hands to the trade register for a household with invoices: company names only, and none with a
 * word of the household's own names. The register is a stub that records what it was asked. Every name is made up.
 */
import { householdWords, type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { PRH_SEARCH_URL } from "../src/providers/prh/client.ts";
import { reprocess } from "../src/services/enrich.ts";
import { askRegister, lookupIndustries } from "../src/services/industry.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";

/** A register that records every name it was asked about and knows one company. */
function stubRegister() {
  const asked: string[] = [];
  const fetchMock = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (!url.href.startsWith(PRH_SEARCH_URL)) throw new Error(`unexpected request ${url.href}`);
    const name = url.searchParams.get("name")!;
    asked.push(name);
    const companies =
      name === "Esimerkki Huolto"
        ? [{ businessId: { value: "1234567-1" }, names: [{ name: "Esimerkki Huolto", type: "1" }], mainBusinessLine: { type: "43340", typeCodeSet: "TOIMI3", descriptions: [{ languageCode: "1", description: "Toimiala 43340" }] } }]
        : [];
    return Response.json({ totalResults: companies.length, companies });
  }) as typeof fetch;
  return { asked, fetchMock };
}

let day = 0;
const raw = (euros: number, counterparty: string, extra: Partial<RawTransaction> = {}): RawTransaction => ({
  externalId: null,
  bookingDate: `2026-09-${String((day++ % 28) + 1).padStart(2, "0")}`,
  valueDate: null,
  amountCents: Math.round(euros * 100),
  currency: "EUR",
  status: "booked",
  counterparty,
  counterpartyIban: null,
  description: null,
  reference: null,
  mcc: null,
  ...extra,
});
const INVOICE = { counterpartyIban: "FI4950009420028731", reference: "1234561" };

/**
 * Two members. One has an account of their own, a joint account and a card, the other an account of their own.
 * `named`: the bank has given the holders and the second member is shown by their first name. Else the household's
 * names are unknown: that run shows what the names keep back.
 */
async function household(named: boolean) {
  const register = stubRegister();
  const t = await setupApp({ INDUSTRY_LOOKUP: "true" }, register.fetchMock);
  const other = await t.member("jasen", named ? "Veera" : "Jäsen");
  const account = { connectionId: null, provider: "csv", externalId: null, identity: null, currency: "EUR", type: "checking" } as const;
  const mine = t.s.finance(t.adminId);
  await mine.upsertAccount({ ...account, id: "chk", name: "Käyttötili", iban: "FI2112345600000785", holder: named ? "MEIKALAINEN AINO" : null });
  await mine.upsertAccount({ ...account, id: "joint", name: "Yhteinen tili", iban: "FI2112345600000786", holder: named ? "MEIKALAINEN AINO, KORHONEN MARIA" : null });
  await mine.upsertAccount({ ...account, id: "card", name: "Luottokortti", iban: null, type: "credit_card" });
  const theirs = t.s.finance(other.id);
  await theirs.upsertAccount({ ...account, id: "chk2", name: "Käyttötili", iban: "FI2112345600000787" });

  await ingestTransactions(
    mine,
    "chk",
    [
      // invoices: a payee account and a reference number
      raw(-180, "ESIMERKKI HUOLTO", INVOICE),
      raw(-95, "ESIMERKKI HUOLTO", INVOICE),
      // a private landlord gives a reference number too, and so does a relative
      raw(-700, "VIRTANEN LIISA", INVOICE),
      raw(-60, "MEIKALAINEN PEKKA", INVOICE),
      // the surname of the joint account's other holder
      raw(-240, "KORHONEN KONSULTOINTI", INVOICE),
      // one bare word: nothing vouches for the first, a card row for the second
      raw(-45, "ZORRO", INVOICE),
      raw(-35, "QUOKKA", INVOICE),
      // money in is never asked about
      raw(20, "ESIMERKKI HUOLTO", INVOICE),
    ],
    "csv",
  );
  await ingestTransactions(mine, "card", [raw(-12, "QUOKKA"), raw(-30, "LANKAPUOTI ILO"), raw(-80, "TMI PEKKA MEIKÄLÄINEN"), raw(-25, "VEERA STUDIO")], "csv");
  // the other member's account names no holder: the surname is known from the first member's accounts
  await ingestTransactions(theirs, "chk2", [raw(-150, "MEIKÄLÄINEN & POJAT OY", INVOICE), raw(-90, "SAUMAUS ESIMERKKI OY", INVOICE)], "csv");
  await reprocess(mine, t.s.settings);
  await reprocess(theirs, t.s.settings);
  return { ...t, ...register, mine };
}

describe("the register is asked about an invoice's payee, never about the household's own names", () => {
  it("hands the register exactly the company names", async () => {
    const { s, asked, mine } = await household(true);
    const before = new Map((await mine.allTransactions()).map((row) => [row.id, row.category]));

    expect(await lookupIndustries(s, { pauseMs: 0 })).toMatchObject({ looked: 4, categorised: 1 });
    expect([...asked].sort()).toEqual(["Esimerkki Huolto", "Lankapuoti Ilo", "Quokka", "Saumaus Esimerkki Oy"]);

    // the answer sorts the invoices it was asked for, the refund is matched to them, and nothing else moves
    for (const row of await mine.allTransactions()) {
      if (row.merchant !== "Esimerkki Huolto") expect(row.category, row.merchant).toBe(before.get(row.id));
      else if (row.amountCents < 0) expect(row).toMatchObject({ category: "home", categorySource: "industry" });
      else expect(row).toMatchObject({ category: "home", categorySource: "match" });
    }
    // a second run asks nothing more
    expect(await lookupIndustries(s, { pauseMs: 0 })).toMatchObject({ looked: 0 });
    expect(asked).toHaveLength(4);
  });

  it("would ask about four names more if the household's names were not known", async () => {
    const { s, asked } = await household(false);
    await lookupIndustries(s, { pauseMs: 0 });
    expect([...asked].sort()).toEqual(["Esimerkki Huolto", "Korhonen Konsultointi", "Lankapuoti Ilo", "Meikäläinen Pojat Oy", "Quokka", "Saumaus Esimerkki Oy", "Tmi Pekka Meikäläinen", "Veera Studio"]);
  });

  it("a couple's names written with a sign do not leave from an invoice alone", async () => {
    const { s, asked, mine } = await household(true);
    const written = ["VIRTANEN LIISA&PEKKA", "LIISA&PEKKA VIRTANEN", "L&P VIRTANEN", "VIRTANEN LIISA+PEKKA", "liisa.virtanen@esimerkki.fi", "'T VIRTANEN LIISA", "A&B ESIMERKKI"];
    for (const payee of written) await ingestTransactions(mine, "chk", [raw(-700, payee, INVOICE), raw(-650, payee, INVOICE)], "csv");
    await reprocess(mine, s.settings);
    await lookupIndustries(s, { pauseMs: 0 });
    expect([...asked].sort()).toEqual(["Esimerkki Huolto", "Lankapuoti Ilo", "Quokka", "Saumaus Esimerkki Oy"]);
  });

  it("a company written with a sign is asked about when a card pays it too", async () => {
    const { s, asked, mine } = await household(true);
    await ingestTransactions(mine, "chk", [raw(-700, "A&B ESIMERKKI", INVOICE), raw(-650, "L&P VIRTANEN", INVOICE)], "csv");
    await ingestTransactions(mine, "card", [raw(-20, "A&B ESIMERKKI")], "csv");
    await reprocess(mine, s.settings);
    await lookupIndustries(s, { pauseMs: 0 });
    expect([...asked].sort()).toEqual(["A&b Esimerkki", "Esimerkki Huolto", "Lankapuoti Ilo", "Quokka", "Saumaus Esimerkki Oy"]);
  });

  it("the shorter form of a name is refused at the door when its last word begins a household word", async () => {
    const { s, asked, mine } = await household(true);
    await ingestTransactions(mine, "card", [raw(-80, "KULJETUS MEIKALAI PALVELU")], "csv");
    await reprocess(mine, s.settings);
    // the whole name is asked about and the register knows no such company; its shorter form would be a relative's start
    expect(await lookupIndustries(s, { pauseMs: 0 })).toMatchObject({ looked: 5 });
    expect([...asked].sort()).toEqual(["Esimerkki Huolto", "Kuljetus Meikalai Palvelu", "Lankapuoti Ilo", "Quokka", "Saumaus Esimerkki Oy"]);
  });

  it("the door refuses a name with a word of the household's, whoever hands it one", async () => {
    const { asked, fetchMock } = stubRegister();
    const names = householdWords(["MEIKALAINEN AINO", "Veera"]);
    for (const name of ["Meikäläinen Huolto", "Veera Studio", "Tmi Pekka Meikalai"]) expect(await askRegister(fetchMock, name, names), name).toEqual({ companies: [], complete: true });
    expect(asked).toEqual([]);
    // the same name with no such word goes through, and so does a household's word when the household is another
    await askRegister(fetchMock, "Lankapuoti Huolto", names);
    await askRegister(fetchMock, "Veera Studio", householdWords(["MEIKALAINEN AINO"]));
    expect(asked).toEqual(["Lankapuoti Huolto", "Veera Studio"]);
  });
});
