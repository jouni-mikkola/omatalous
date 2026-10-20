import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isKnownCategory } from "../src/categories.ts";
import { lexiconCategory } from "../src/lexicon.ts";
import { LEXICON } from "../src/lexicon-data.ts";
import { industryCandidates } from "../src/industry.ts";
import { createWhy } from "../src/explain/why.ts";
import { sentenceOf } from "../src/explain/catalogue.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, CategoryRule, Transaction } from "../src/types.ts";

/** A card purchase: no payee account. */
const card = (merchant: string) => lexiconCategory({ merchant, counterparty: merchant, description: "KORTTIOSTO", counterpartyIban: null })?.category ?? null;
/** A credit transfer with the payee's account. */
const transfer = (name: string, description = "LASKU 123") => lexiconCategory({ merchant: name, counterparty: name, description, counterpartyIban: "FI5112345600000827" })?.category ?? null;

const companies = LEXICON.filter((entry) => entry.kind !== "stem");
const stems = LEXICON.filter((entry) => entry.kind === "stem");
const categories = [...new Set(companies.map((entry) => entry.category))];
const namesOf = (entries: typeof LEXICON) => entries.flatMap((entry) => entry.names.map((name) => ({ name, entry })));

describe("the lexicon's data", () => {
  it("files under categories that exist, in folded names, once each", () => {
    const all = LEXICON.flatMap((entry) => entry.names.map((name) => ({ name, category: entry.category })));
    expect(all.filter(({ category }) => !isKnownCategory(category))).toEqual([]);
    expect(all.filter(({ name }) => !/^=?[A-Z0-9][A-Z0-9 .-]*$/.test(name))).toEqual([]);
    const seen = all.map(({ name }) => name);
    expect(seen.filter((name, i) => seen.indexOf(name) !== i)).toEqual([]);
  });

  it("leaves out the trade words that are too common, and the foreign brands", () => {
    const names = new Set(namesOf(LEXICON).map(({ name }) => name));
    for (const word of ["PULLA", "MATKA", "JUNA", "DIESEL", "KUNTO", "TALLI", "SPORTTI", "PELI", "PELIT", "GAMING", "LEHTI", "UNIONI", "LINSSI", "OPISKELU", "TUKIJA", "HAKEMUSMAKSU", "GYMNASIUM", "NOUTO", "PITA", "LAUTTA", "SUOMENLINNA", "HOITOLA", "SEURAKUNTAYHTYMA"]) expect(names.has(word), word).toBe(false);
    for (const brand of ["KFC", "AUDI", "NARVESEN", "REVOLUT", "HELLOFRESH", "CIRCLE K", "SEPPALA", "ROVIO"]) expect(names.has(brand), brand).toBe(false);
  });

  it("marks the payment services, which file nothing", () => {
    const names = namesOf(companies.filter((entry) => entry.kind === "intermediary")).map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining(["EPASSI", "SMARTUM", "EDENRED", "HUUTO.NET", "AVARDA", "NEXI", "BAMBORA", "WORLDLINE"]));
    for (const name of names) expect(card(`${name} KANGASALA 123`), name).toBeNull();
  });
});

describe("the company rows, one table a category", () => {
  it.each(categories)("%s: a brand with a city and a store number is filed, a word that only starts or ends with it is not", (category) => {
    const rows = namesOf(companies.filter((entry) => entry.category === category && entry.kind !== "intermediary"));
    for (const { name } of rows) {
      // "=": the whole payee field only
      expect(card(name.startsWith("=") ? name.slice(1) : `${name} KANGASALA 123`), name).toBe(category);
      // a name of one word is no word when glued to a longer one; a longer name's first word alone is no brand
      if (name.includes(" ")) expect(card(name.split(" ")[0]!), name.split(" ")[0]).toBe(rows.some((r) => r.name === `=${name.split(" ")[0]}`) ? category : null);
      else {
        expect(card(`${name}KKA`), `${name}KKA`).toBeNull();
        expect(card(`MI${name}`), `MI${name}`).toBeNull();
      }
    }
  });

  it("reads the spellings a bank writes: hyphen, space, a legal form, diacritics, a different case", () => {
    expect(card("A KATSASTUS TAMPERE")).toBe("car");
    expect(card("A-KATSASTUS TAMPERE")).toBe("car");
    expect(card("Jyväskylän Energia Oy")).toBe("utilities");
    expect(card("Hämeen Sanomat Oy")).toBe("subscriptions");
    expect(card("Huuto.net Oyj")).toBeNull();
    expect(card("HALPA-HALLI KOKKOLA")).toBe("groceries");
    expect(card("Halpahalli Kokkola")).toBe("groceries");
    expect(card("Lapuan Kankurit Oy")).toBe("home");
    expect(card("ONNINEN OY ESPOO")).toBe("home");
  });

  it("keeps the false friends out", () => {
    // the newspaper, not the mutual insurer, and not the district of Tampere
    expect(card("KALEVA")).toBe("subscriptions");
    expect(card("KALEVA OY")).toBe("subscriptions");
    expect(card("KALEVA MEDIA")).toBe("subscriptions");
    expect(card("ESIMERKKIPUOTI KALEVA")).toBeNull();
    expect(card("KALEVA TAMPERE")).toBeNull();
    expect(card("KALEVA KESKINAINEN VAKUUTUSYHTIO")).toBeNull();
    // Garantia's fee is a housing loan's
    expect(card("GARANTIA")).toBe("loans");
    // an acronym is a whole word of the payee
    expect(card("PAM")).toBe("memberships");
    expect(card("PAMPERS KAUPPA")).toBeNull();
    expect(card("AKT")).toBe("memberships");
    expect(card("LAKTO AKTIVI")).toBeNull();
    // the postal companies are no row (the item posted decides), the union of the post is
    expect(card("POSTI HELSINKI 12")).toBeNull();
    expect(card("POSTI- JA LOGISTIIKKA-ALAN UNIONI")).toBe("memberships");
    expect(card("AMMATTILIITTO PRO")).toBe("memberships");
    expect(card("PRO TAMPERE")).toBeNull();
    expect(card("IF VAKUUTUS")).toBe("insurance");
    expect(card("IF KOTKA")).toBeNull();
  });

  it("does not file a dealer's or a brand's financing company as a purchase", () => {
    expect(card("BMW HELSINKI")).toBe("car");
    expect(card("BMW FINANCIAL SERVICES")).toBeNull();
    expect(card("VOLVO CAR RAHOITUS")).toBeNull();
    expect(card("FORD CREDIT")).toBeNull();
  });
});

describe("the stem rows", () => {
  const rows = namesOf(stems);

  it("file the start of a trade word at the start of a word of the payee", () => {
    for (const { name, entry } of rows) {
      expect(card(`XYZ ${name}`), `XYZ ${name}`).toBe(entry.category);
      // a whole-word stem (WOK) is no start of a longer word
      expect(card(`${name}ABC ESPOO`), `${name}ABC`).toBe(entry.whole ? null : entry.category);
      // nor of a street or a place
      for (const end of ["NKATU", "NTIE", "NKUJA", "NPOLKU", "NTORI", "NAUKIO", "NRANTA", "NVAYLA", "NPUISTO", "NGATAN", "NVAGEN"]) expect(card(`XYZ ${name}${end}`), `${name}${end}`).toBeNull();
      if (!name.includes(" ")) expect(card(`MI${name}`), `MI${name}`).toBeNull();
    }
  });

  it("do not file a name that only holds a trade word in the middle of a word", () => {
    expect(card("MIKKUNTOKESKUS")).toBeNull();
    expect(card("KUNTOKESKUS ABC")).toBe("fitness");
    expect(card("XYZ HAMMASLAAKARIASEMA")).toBe("health");
    expect(card("RIIPPAKAFFE")).toBeNull();
  });

  it("are looked for in the payee, not in the bank's text of a purchase", () => {
    expect(lexiconCategory({ merchant: "ESIMERKKI KIOSKI", counterparty: "ESIMERKKI KIOSKI", description: "PIZZA KORTTIOSTO" })).toBeNull();
  });

  it("leave out the words that are too common alone, and car rental is travel", () => {
    for (const word of ["PULLA", "MATKA", "JUNA", "DIESEL", "KUNTO", "TALLI", "SPORTTI", "PELI", "PELIT", "GAMING", "LEHTI", "UNIONI", "LINSSI", "OPISKELU", "TUKIJA", "HAKEMUSMAKSU", "GYMNASIUM", "NOUTO", "PITA"]) expect(card(`XYZ ${word}`), word).toBeNull();
    expect(card("ESIMERKKI AUTOVUOKRAUS")).toBe("travel");
  });

  it("are weaker than every company row", () => {
    expect(card("JULA RENGASLIIKE")).toBe("home");
    expect(card("NOKIAN TYRES KANGASALA")).toBe("car");
    expect(card("SOKOS HOTEL KAHVIO")).toBe("travel");
    expect(card("ESIMERKKI KAHVIO")).toBe("restaurants");
  });
});

describe("a person named like a brand or a trade word", () => {
  it("is a person on a transfer and is not filed", () => {
    for (const name of ["Matti Seppala", "Liisa Fiskars", "Matti Rukka", "Aino Halti", "Eero Pizzala", "Maija Kunto", "Eero Hoitola"]) expect(transfer(name), name).toBeNull();
    expect(transfer("Liisa Fiskars", "KIITOS LAINASTA")).toBeNull();
  });

  it("the same brand as a card purchase or a bill is filed", () => {
    expect(card("FISKARS HELSINKI")).toBe("home");
    expect(transfer("FISKARS OY AB")).toBe("home");
    expect(transfer("Lapin Kansa")).toBe("subscriptions");
    expect(transfer("KOTKAN ENERGIA OY", "SAHKOLASKU")).toBe("utilities");
  });
});

// ── the pipeline: what the lexicon may and may not move ──

const accounts: Account[] = [{ id: "card", name: "ESIMERKKI KORTTI", iban: null, currency: "EUR", type: "credit_card" }, { id: "chk", name: "ESIMERKKI TILI", iban: "FI2112345600000785", currency: "EUR", type: "checking" }];
let n = 0;
const tx = (merchant: string, amountCents: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  accountId: "card",
  bookingDate: `2026-0${1 + (n % 9)}-10`,
  amountCents,
  currency: "EUR",
  status: "booked",
  counterparty: merchant,
  counterpartyIban: null,
  description: "KORTTIOSTO",
  mcc: null,
  merchant,
  category: amountCents < 0 ? "other" : "income",
  categorySource: "default",
  isTransfer: false,
  ...extra,
});
const run = (txs: Transaction[], rules: CategoryRule[] = []) => {
  const changed = new Map(enrichTransactions(txs, accounts, rules, new Map()).map((t) => [t.id, t]));
  return txs.map((t) => changed.get(t.id) ?? t);
};
const rule = (pattern: string, category: string): CategoryRule => ({ field: "merchant", pattern, category, priority: 10 });

describe("the lexicon in the pipeline", () => {
  it("files a card purchase that nothing else filed: a brand as a rule, a trade word as an industry guess", () => {
    const [a, b] = run([tx("RUSTA KANGASALA 123", -4500), tx("ESIMERKKI KAHVIO ESPOO", -450)]);
    expect([a?.category, a?.categorySource]).toEqual(["home", "rule"]);
    expect([b?.category, b?.categorySource]).toEqual(["restaurants", "industry"]);
  });

  it("a rule of the user's on a lexicon payee wins, and so does a row the user filed", () => {
    const rows = run([tx("JULA KANGASALA", -4500), tx("JULA TAMPERE", -1200, { category: "gifts_donations", categorySource: "user" })], [rule("JULA", "shopping")]);
    expect(rows.map((t) => t.category)).toEqual(["shopping", "gifts_donations"]);
    expect(rows[1]?.categorySource).toBe("user");
  });

  it("does not re-file a row a stronger source filed: a card's code, a built-in rule, the payee's other purchases", () => {
    // the merchant code says grocery shop
    const [coded] = run([tx("ONNINEN ESPOO", -4500, { mcc: "5411" })]);
    expect(coded?.categorySource).toBe("mcc");
    expect(coded?.category).toBe("groceries");
    // a built-in rule: the hotel's own rule files it, with its restaurant's word
    const [hotel] = run([tx("SOKOS HOTEL VAAKUNA RAVINTOLA", -4500)]);
    expect(hotel?.category).not.toBe("home");
    // the same payee's other purchases (the same shop, with and without a merchant code)
    const same = run([tx("JULA KANGASALA", -1000, { mcc: "5411" }), tx("JULA KANGASALA", -2000, { mcc: "5411" }), tx("JULA KANGASALA", -3000, { mcc: "5411" }), tx("JULA KANGASALA", -4000)]);
    expect(same.map((t) => t.category)).toEqual(["groceries", "groceries", "groceries", "groceries"]);
    expect(same[3]?.categorySource).toBe("merchant");
  });

  it("keeps the leasing and energy payees of the payee list where they are", () => {
    const rows = run([tx("AYVENS FINLAND", -39_900), tx("OULUN ENERGIA OY", -8_200, { description: "SAHKOLASKU" })]);
    expect(rows.map((t) => [t.category, t.categorySource])).toEqual([["leasing", "rule"], ["utilities", "rule"]]);
  });

  it("files money out only: a refund from a brand is not spending", () => {
    const [refund] = run([tx("RUSTA KANGASALA 123", 4500, { accountId: "chk" })]);
    expect(refund?.category).toBe("income");
    expect(refund?.categorySource).toBe("default");
  });

  it("does not file a payment service or a person named like a brand", () => {
    const [service, person, fiskars] = run([
      tx("EPASSI KANGASALA", -1500),
      tx("Liisa Fiskars", -2500, { accountId: "chk", counterpartyIban: "FI5112345600000827", description: "KIITOS" }),
      tx("FISKARS HELSINKI", -3500),
    ]);
    expect(service?.categorySource).toBe("default");
    const people = run(["Matti Seppala", "Liisa Fiskars", "Matti Rukka", "Eero Hoitola"].map((name) => tx(name, -2500, { accountId: "chk", counterpartyIban: "FI5112345600000827", description: "KIITOS" })));
    for (const t of people) expect(["p2p", "other"], t.merchant).toContain(t.category);
    expect(person?.categorySource).not.toBe("rule");
    expect(person?.category).not.toBe("home");
    expect(fiskars?.category).toBe("home");
  });
});

describe("what a stem or a brand must not catch", () => {
  /** merchant.ts's own list of towns, districts and malls, read as the text it is (no export of it has a reader). */
  const places = [...readFileSync(new URL("../src/merchant.ts", import.meta.url), "utf8").split("const PLACES = [")[1]!.split("\n];")[0]!.matchAll(/"([A-Z0-9 ]+)"/g)].map((m) => m[1]!);

  it("no stem is a place name or the start of one, nor a street's name", () => {
    expect(places.length).toBeGreaterThan(100);
    expect(places).toContain("LAUTTASAARI");
    for (const place of places) {
      expect(card(`ESIMERKKIPUOTI ${place}`), place).toBeNull();
      for (const end of ["KATU", "TIE", "KUJA", "POLKU", "TORI", "AUKIO", "RANTA", "VAYLA", "PUISTO", "GATAN", "VAGEN"]) expect(card(`ESIMERKKIPUOTI ${place}${end}`), `${place}${end}`).toBeNull();
    }
    expect(card("ESIMERKKIPUOTI YLIOPISTONKATU")).toBeNull();
    expect(card("ESIMERKKIPUOTI LEIPURINKATU")).toBeNull();
    expect(card("ESIMERKKIPUOTI LEIPURINTIE 4")).toBeNull();
    expect(card("ESIMERKKI LEIPURI")).toBe("restaurants");
  });

  it("whole-word stems: WOK and NAILS are no start of a longer word", () => {
    expect(card("XYZ WOK")).toBe("restaurants");
    expect(card("WOKKI ESPOO")).toBeNull();
    expect(card("XYZ NAILS")).toBe("personal_care");
    expect(card("NAILSWORTH LTD")).toBeNull();
  });

  it("reads the text only on a card purchase: a brand in an invoice's or a transfer's message files nothing", () => {
    for (const message of ["ONNEA JARI-PEKKA 50V", "LAHJA VOLVO-KERHOLLE", "LAHJA RUSTA KORTTI"]) {
      expect(lexiconCategory({ merchant: "ESIMERKKI OY", counterparty: "ESIMERKKI OY", description: message, counterpartyIban: "FI5112345600000827" }), message).toBeNull();
    }
    // the same words on a card purchase are the shop's
    expect(lexiconCategory({ merchant: "ESIMERKKIPUOTI", counterparty: "ESIMERKKIPUOTI", description: "VOLVO HELSINKI", counterpartyIban: null })?.category).toBe("car");
    // a first name is no brand in the text at all, and as a payee it is one
    expect(lexiconCategory({ merchant: "ESIMERKKIPUOTI", counterparty: "ESIMERKKIPUOTI", description: "ONNEA JARI-PEKKA 50V", counterpartyIban: null })).toBeNull();
    expect(card("JARI-PEKKA OULU")).toBe("car");
  });

  it("a payment service's name is taken out and the rest is read", () => {
    expect(card("BAMBORA RUSTA KANGASALA")).toBe("home");
    expect(card("EPASSI KUNTOKESKUS X")).toBe("fitness");
    expect(card("EPASSI PAYMENTS KANGASALA")).toBeNull();
    expect(card("SMARTUM")).toBeNull();
    expect(card("PAYSAFECARD RUSTA KANGASALA")).toBe("home");
    expect(card("PAYSAFECARD")).toBeNull();
  });

  it("a card text with a word of credit does not stop a brand; the financing company's own name does", () => {
    expect(lexiconCategory({ merchant: "JULA KANGASALA", counterparty: "JULA KANGASALA", description: "LUOTTOKORTTIOSTO", counterpartyIban: null })?.category).toBe("home");
    expect(card("JULA RAHOITUS")).toBeNull();
  });

  it("files the stem as industry and the company as rule, and says so", () => {
    expect(lexiconCategory({ merchant: "XYZ HAMMASHOITOLA", counterparty: "XYZ HAMMASHOITOLA", description: null })).toEqual({ category: "health", source: "industry" });
    expect(lexiconCategory({ merchant: "JULA KANGASALA", counterparty: "JULA KANGASALA", description: null })).toEqual({ category: "home", source: "rule" });
  });
});

describe("a trade word's row in the pipeline reads like a register guess", () => {
  const rows = () => [tx("KAHVIO ESIMERKKI OY", -6500), tx("JULA KANGASALA", -4500)];

  it("the stem's row is 'industry' and the company's 'rule'", () => {
    const [stemRow, brandRow] = run(rows());
    expect([stemRow?.category, stemRow?.categorySource]).toEqual(["restaurants", "industry"]);
    expect([brandRow?.category, brandRow?.categorySource]).toEqual(["home", "rule"]);
  });

  it("the why of the row says the trade, not an automatic rule", () => {
    const txs = rows();
    const why = createWhy("own");
    enrichTransactions(txs, accounts, [], new Map(), undefined, why);
    expect(sentenceOf(why.of(txs[0]!.id)[0]!)).toBe("Luokiteltu kaupan toimialan mukaan");
    expect(sentenceOf(why.of(txs[1]!.id)[0]!)).toBe("Luokiteltu automaattisesti");
  });

  it("is asked of the register too, so that a found entry can replace the stem's guess", () => {
    const [stemRow] = run(rows());
    // a row that a stem filed is still a candidate: the register's answer outranks the stem (pipeline.ts)
    expect(industryCandidates([stemRow!], accounts)).toEqual(["KAHVIO ESIMERKKI OY"]);
    expect(industryCandidates([tx("KAHVIO ESIMERKKI OY", -6500)], accounts)).toEqual(["KAHVIO ESIMERKKI OY"]);
    // near miss: a company row's "rule" is certain and is not asked about
    const [, brandRow] = run(rows());
    expect(brandRow?.categorySource).toBe("rule");
    expect(industryCandidates([brandRow!], accounts)).toEqual([]);
  });
});
