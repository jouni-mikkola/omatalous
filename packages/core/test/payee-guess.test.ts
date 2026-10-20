import { describe, expect, it } from "vitest";
import { addDays } from "../src/dates.ts";
import { householdWords } from "../src/payee-guard.ts";
import { payeeGuesser } from "../src/payee-guess.ts";
import type { CategoryRule, Transaction } from "../src/types.ts";
import { randomHistory, rng } from "./gen.ts";
import { series, tx } from "./helpers.ts";

const NONE = new Map<string, string>();
const NOBODY: ReadonlySet<string> = new Set();

function guesser(rows: Transaction[], opts: { rules?: CategoryRule[]; industries?: Map<string, string>; household?: ReadonlySet<string> } = {}) {
  return payeeGuesser({ rows, rules: opts.rules ?? [], industries: opts.industries ?? NONE, household: opts.household ?? NOBODY });
}

/** Rows of a payee nothing classified: money out, three purchases. */
const unsorted = (merchant: string, partial: Partial<Transaction> = {}) =>
  [0, 1, 2].map((i) => tx({ merchant, counterparty: merchant.toUpperCase(), bookingDate: addDays("2025-03-01", i * 17), amountCents: -2500 - i * 300, ...partial }));
/** Rows the household sorted by hand. */
const sorted = (merchant: string, category: string, amountCents = -3000) =>
  [0, 1].map((i) => tx({ merchant, counterparty: merchant.toUpperCase(), bookingDate: addDays("2025-01-10", i * 20), amountCents, category, categorySource: "user" }));

describe("payee guess: the household's own answers", () => {
  it("a payee of the same stem the household sorted gives its category, with the payee named", () => {
    const rank = guesser([...sorted("Happy Dog Trimmi Kallio", "pets"), ...unsorted("Happy Dog Trimmi Espoo")]);
    const { guess } = rank("Happy Dog Trimmi Espoo", "out");
    expect(guess).toMatchObject({ category: "pets", reason: "Sama luokka kuin Happy Dog Trimmi Kallio" });
  });

  it("a merchant_exact rule counts as the household's answer", () => {
    const rows = [...unsorted("Happy Dog Trimmi Kallio", { category: "pets", categorySource: "rule" }), ...unsorted("Happy Dog Trimmi Espoo")];
    const rules: CategoryRule[] = [{ id: 1, field: "merchant_exact", pattern: "Happy Dog Trimmi Kallio", category: "pets", priority: 1 }];
    expect(guesser(rows, { rules })("Happy Dog Trimmi Espoo", "out").guess?.category).toBe("pets");
  });

  it("some of the payee's own rows sorted by hand give their category", () => {
    const rank = guesser([...sorted("Lumi Palvelut", "home"), ...unsorted("Lumi Palvelut")]);
    expect(rank("Lumi Palvelut", "out").guess?.category).toBe("home");
  });

  it("near misses: another stem, a split household, the other side", () => {
    expect(guesser([...sorted("Happy Cat Hoitola", "pets"), ...unsorted("Happy Dog Trimmi Espoo")])("Happy Dog Trimmi Espoo", "out").guess).toBeNull();
    const split = guesser([...sorted("Happy Dog Trimmi Kallio", "pets"), ...sorted("Happy Dog Trimmi Turku", "shopping"), ...unsorted("Happy Dog Trimmi Espoo")])("Happy Dog Trimmi Espoo", "out");
    expect(split.guess).toBeNull();
    expect(split.candidates.map((c) => c.category).sort()).toEqual(["pets", "shopping"]);
    // an income category never answers money out, a spending one never money in
    const side = guesser([...sorted("Happy Dog Trimmi Kallio", "pets"), ...unsorted("Happy Dog Trimmi Espoo", { amountCents: 5000 })]);
    expect(side("Happy Dog Trimmi Espoo", "in").candidates).toEqual([]);
  });
});

describe("payee guess: the name against the word lists", () => {
  it("a stem of the lexicon at the start of a word gives its trade", () => {
    expect(guesser(unsorted("Lumon Sisustusliike Oy"))("Lumon Sisustusliike Oy", "out").guess).toMatchObject({ category: "home", reason: "Nimen perusteella" });
  });

  it("near miss: a stem inside a word says nothing", () => {
    expect(guesser(unsorted("Pikasisustus Oy"))("Pikasisustus Oy", "out").candidates).toEqual([]);
  });
});

describe("payee guess: the purpose in the bank's text", () => {
  // a telecom company nothing knows, paid by invoice: the household's most used category (groceries) is no answer
  const tele = (description: string) => unsorted("Esimerkki Tele Oy", { description, counterpartyIban: "FI2112345600000785" });
  const shopping = [0, 1, 2, 3, 4].map((i) => tx({ merchant: "K-Market Esimerkki", bookingDate: addDays("2025-02-01", i * 7), amountCents: -4200, category: "groceries", categorySource: "rule" }));

  it("a phone connection is the phone category, first", () => {
    const ranked = guesser([...shopping, ...tele("PUHELINLIITTYMA")])("Esimerkki Tele Oy", "out");
    expect(ranked.guess).toMatchObject({ category: "telecom", reason: "Maksun tekstin perusteella" });
    expect(ranked.candidates.map((c) => c.category)).toEqual(["telecom"]);
  });

  it("near misses: an electricity connection, a word inside another", () => {
    expect(guesser(tele("SAHKOLIITTYMA"))("Esimerkki Tele Oy", "out").candidates).toEqual([]);
    expect(guesser(tele("ESIMERKKIPUHELINLIITTYMA"))("Esimerkki Tele Oy", "out").candidates).toEqual([]);
  });
});

describe("payee guess: the stored register industry", () => {
  it("the industry stored for the payee gives its category", () => {
    const industries = new Map([["Aaltonen Konsultointi Oy", "home"]]);
    expect(guesser(unsorted("Aaltonen Konsultointi Oy"), { industries })("Aaltonen Konsultointi Oy", "out").guess).toMatchObject({ category: "home", reason: "Kaupparekisterin toimiala" });
  });

  it("near misses: another payee's industry, an income industry for money out", () => {
    expect(guesser(unsorted("Aaltonen Konsultointi Oy"), { industries: new Map([["Aaltonen Rakennus Oy", "home"]]) })("Aaltonen Konsultointi Oy", "out").guess).toBeNull();
    expect(guesser(unsorted("Aaltonen Konsultointi Oy"), { industries: new Map([["Aaltonen Konsultointi Oy", "salary"]]) })("Aaltonen Konsultointi Oy", "out").candidates).toEqual([]);
  });
});

describe("payee guess: the card code", () => {
  it("coded rows that agree give their category", () => {
    const rows = unsorted("Qwerty Puoti Oy", { mcc: "5812" });
    expect(guesser(rows)("Qwerty Puoti Oy", "out").guess).toMatchObject({ category: "restaurants", reason: "Korttimaksun toimialakoodi" });
  });

  it("near miss: coded rows that disagree give nothing", () => {
    const rows = [...unsorted("Qwerty Puoti Oy", { mcc: "5812" }), ...unsorted("Qwerty Puoti Oy", { mcc: "5411" })];
    expect(guesser(rows)("Qwerty Puoti Oy", "out").candidates).toEqual([]);
  });
});

describe("payee guess: the amount pattern", () => {
  const before = series("2025-01-05", 30, 4, -1490, { merchant: "Vanha Palvelu Oy", category: "subscriptions", categorySource: "user" });
  const after = series(addDays("2025-01-05", 30 * 4), 30, 3, -1490, { merchant: "Uusi Palvelu Oy" });

  it("a monthly sum that carries on a sorted one is a candidate but never shown alone", () => {
    const ranked = guesser([...before, ...after])("Uusi Palvelu Oy", "out");
    expect(ranked.candidates).toEqual([{ category: "subscriptions", points: 2, reason: "Sama kuukausisumma kuin Vanha Palvelu Oy" }]);
    expect(ranked.guess).toBeNull();
  });

  it("with the register beside it the guess is shown", () => {
    const ranked = guesser([...before, ...after], { industries: new Map([["Uusi Palvelu Oy", "subscriptions"]]) })("Uusi Palvelu Oy", "out");
    expect(ranked.guess).toMatchObject({ category: "subscriptions", points: 5 });
  });

  it("near misses: another sum, a gap of months", () => {
    const other = series(addDays("2025-01-05", 30 * 4), 30, 3, -1590, { merchant: "Uusi Palvelu Oy" });
    expect(guesser([...before, ...other])("Uusi Palvelu Oy", "out").candidates).toEqual([]);
    const late = series(addDays("2025-01-05", 30 * 7), 30, 3, -1490, { merchant: "Uusi Palvelu Oy" });
    expect(guesser([...before, ...late])("Uusi Palvelu Oy", "out").candidates).toEqual([]);
  });
});

describe("payee guess: a person", () => {
  it("a name shaped like a person's is never guessed a business category, whatever the evidence", () => {
    const rows = [...sorted("Matti Meikäläinen Kallio", "pets"), ...unsorted("Matti Meikäläinen", { mcc: "5812" })];
    const ranked = guesser(rows, { industries: new Map([["Matti Meikäläinen", "home"]]) })("Matti Meikäläinen", "out");
    expect(ranked).toEqual({ candidates: [], guess: null });
  });

  it("a word of the household's names is a person's too", () => {
    const rows = unsorted("Virtasen Sisustusliike Oy");
    const household = householdWords(["Liisa Virtanen", "Virtasen"]);
    expect(guesser(rows, { household })("Virtasen Sisustusliike Oy", "out").guess).toBeNull();
  });
});

/**
 * Random households with planted payees: each payee's truth is the category the household would give it. The evidence
 * is right most of the time but not always: a branch of a chain that sells something else, a register entry of the
 * holding company, a card code of the terminal's owner. Payees with no evidence, with evidence that only supports, with
 * a split household and with a person's name have no guess to show.
 */
describe("payee guess: random households", () => {
  const BUSINESSES: readonly [string, string][] = [
    ["Happy Dog Trimmi", "pets"],
    ["Lumon Puutarha Palvelu", "home"],
    ["Kotikulman Leipä Myymälä", "groceries"],
    ["Rantapuiston Sali Center", "fitness"],
    ["Sinisen Hetken Studio", "personal_care"],
    ["Pohjan Pyörä Vuokraus", "transport"],
    ["Kivikoski Lelut Outlet", "kids"],
    ["Aamuruskon Kirja Puoti", "shopping"],
  ];
  const REGISTERED: readonly [string, string][] = [
    ["Aaltola Konsultointi Oy", "home"],
    ["Metsäranta Group Oy", "fitness"],
    ["Kuuraniemi Services Oy", "personal_care"],
    ["Nordwick Trading Ab", "shopping"],
  ];
  const CODED: readonly [string, string, string][] = [
    ["Satamakulma Oy", "5812", "restaurants"],
    ["Hiekka Store Oy", "5411", "groceries"],
    ["Revontuli Spa Oy", "7230", "personal_care"],
  ];
  const WORDED: readonly [string, string][] = [
    ["Lumon Sisustusliike Oy", "home"],
    ["Esimerkin Kenkäkauppa Oy", "shopping"],
    ["Järvisen Kiinteistöhuolto Oy", "housing"],
  ];
  const QUIET = ["Zeta Konsultit Oy", "Rautio Tmi", "Kesälahti Palvelut Oy", "Lintula Works", "Qx Solutions Oy"];
  const PEOPLE = ["Matti Meikäläinen", "Liisa Virtanen", "Kari Korhonen", "Anna Laine"];
  const PLACES = ["Kallio", "Espoo", "Tampere", "Turku", "Oulu"];
  const OTHER = ["groceries", "home", "shopping", "restaurants"];

  interface Plant {
    merchant: string;
    truth: string;
    /** Whether a guess may be shown: evidence was planted. */
    evidenced: boolean;
  }

  function household(seed: number) {
    const r = rng(seed * 31 + 7);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
    const { txs } = randomHistory(seed, 300);
    const rows: Transaction[] = [...txs];
    const industries = new Map<string, string>();
    const plants: Plant[] = [];
    // the evidence is wrong for one payee in about twenty
    const truthOf = (category: string) => (r() < 0.05 ? pick(OTHER.filter((c) => c !== category)) : category);
    const ask = (merchant: string, partial: Partial<Transaction> = {}) => rows.push(...unsorted(merchant, partial));

    for (const [stem, category] of BUSINESSES) {
      if (r() < 0.5) continue;
      const [a, b] = [pick(PLACES), pick(PLACES)];
      if (a === b) continue;
      rows.push(...sorted(`${stem} ${a}`, category));
      if (r() < 0.2) {
        // a split household: another branch sorted otherwise
        rows.push(...sorted(`${stem} Keskusta`, pick(OTHER.filter((c) => c !== category))));
        ask(`${stem} ${b}`);
        plants.push({ merchant: `${stem} ${b}`, truth: category, evidenced: false });
      } else {
        ask(`${stem} ${b}`);
        plants.push({ merchant: `${stem} ${b}`, truth: truthOf(category), evidenced: true });
      }
    }
    for (const [merchant, category] of REGISTERED) {
      if (r() < 0.5) continue;
      industries.set(merchant, category);
      ask(merchant);
      plants.push({ merchant, truth: truthOf(category), evidenced: true });
    }
    for (const [merchant, mcc, category] of CODED) {
      if (r() < 0.5) continue;
      ask(merchant, { mcc });
      plants.push({ merchant, truth: truthOf(category), evidenced: true });
    }
    for (const [merchant, category] of WORDED) {
      if (r() < 0.5) continue;
      ask(merchant);
      plants.push({ merchant, truth: truthOf(category), evidenced: true });
    }
    for (const merchant of QUIET) if (r() < 0.5) plants.push({ merchant, truth: pick(OTHER), evidenced: false });
    // a person with the evidence of a business: a register entry and a card code
    const person = pick(PEOPLE);
    industries.set(person, "home");
    ask(person, { mcc: "5812" });
    plants.push({ merchant: person, truth: "p2p", evidenced: false });
    // a new service at the sum of an old one: support only
    rows.push(...series("2025-01-05", 30, 4, -1490, { merchant: "Vanha Palvelu Oy", category: "subscriptions", categorySource: "user" }));
    rows.push(...series(addDays("2025-01-05", 120), 30, 3, -1490, { merchant: "Uusi Palvelu Oy" }));
    plants.push({ merchant: "Uusi Palvelu Oy", truth: "subscriptions", evidenced: false });
    return { rows, industries, plants };
  }

  it("the guess is right at least 90 % of the time when shown and quiet without evidence", () => {
    let shown = 0;
    let right = 0;
    let evidenced = 0;
    const loud: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const { rows, industries, plants } = household(seed);
      const rank = guesser(rows, { industries, household: householdWords(["Jouko Esimerkki"]) });
      for (const p of plants) {
        const { guess } = rank(p.merchant, "out");
        if (p.evidenced) evidenced++;
        if (!guess) continue;
        if (!p.evidenced) loud.push(`${seed}: ${p.merchant} ${guess.category}`);
        shown++;
        if (guess.category === p.truth) right++;
      }
    }
    expect(loud).toEqual([]);
    expect(right / shown).toBeGreaterThanOrEqual(0.9);
    // most payees with evidence get their guess
    expect(shown / evidenced).toBeGreaterThanOrEqual(0.9);
  }, 30_000);
});
