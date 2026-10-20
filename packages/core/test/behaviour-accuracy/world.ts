/**
 * Made-up households with hand-labelled ground truth for the behaviour detectors. Each is the kit's steady household
 * (kit/household.ts: 30 months, pay on the 25th, a connected Gold card) with behaviours planted on purpose and decoys
 * that look like them, chosen by the seed so the population holds every case and its near misses. The truth is what
 * really happened in the made-up story, not what a rule would say: a friend who paid 70 % of a cinema ticket split a
 * bill, and a detector that misses it loses recall. Names are made up.
 */
import { addDays, dayNumber, fromDayNumber, weekdayOf } from "../../src/dates.ts";
import { fold, normalizeMerchant } from "../../src/merchant.ts";
import type { Transaction } from "../../src/types.ts";
import type { Household } from "../../../../tools/findings/households.ts";
import { banking, frameOf, type Frame, rows } from "../kit/frame.ts";
import { HISTORY_MONTHS, householdOf, steadyRows, withCardBills } from "../kit/household.ts";
import type { NoiseModel } from "../kit/noise.ts";
import { cardConnectedLate } from "../kit/events/card-connected-late.ts";

export const TODAY = "2026-10-18";

export type CreditCase = "stack" | "old-lines" | "one-new" | "late-second" | "none";
export type LinkCase = "pays-credit" | "draw-buys" | "none";
export type PaydayCase = "spike" | "moderate" | "mild" | "bills-on-payday" | "none";

export interface Truth {
  credit: CreditCase;
  /** Two consumer credits or more opened in the last 180 days while three or more run (the signal's definition, on the story's facts). */
  stacked: boolean;
  link: LinkCase;
  /** Row ids of credit drawn to pay other credit. */
  linkDraws: Set<string>;
  payday: PaydayCase;
  /** Spending after pay day really runs faster than the days before: about 2,5 times (spike) or 1,6 times (moderate). */
  paydaySpike: boolean;
  /** Purchase row ids whose cost friends really shared. */
  splits: Set<string>;
  /** The ones of them whose shares are exact (the strict rule of returns.ts should net them). */
  exactSplits: Set<string>;
  /** Folded merchants whose price really rose. */
  priceRises: Set<string>;
  /** Row ids of real gambling stakes (money out to a gambling operator). */
  stakes: Set<string>;
  /** The stakes friends put in together. */
  sharedStakes: Set<string>;
}

export interface Labelled {
  household: Household;
  truth: Truth;
}

const CREDIT: readonly CreditCase[] = ["stack", "old-lines", "one-new", "late-second", "none"];
const LINKS: readonly LinkCase[] = ["pays-credit", "draw-buys", "none"];
const PAYDAYS: readonly PaydayCase[] = ["spike", "moderate", "mild", "bills-on-payday", "none"];
const LATE_CARD: ReadonlySet<number> = new Set([3, 6, 9, 14, 17]);
const FRIENDS = ["LIISA VIRTANEN", "PEKKA KORHONEN", "ANNA NIEMINEN", "JUHA MAKINEN", "SARI LAINE", "MIKKO HEIKKINEN", "TIINA KOSKINEN", "VILLE JARVINEN"];

/** The household of `seed`: its cases rotate with the seed, so 20 seeds hold each credit case with most pay day cases. */
export function labelled(seed: number): Labelled {
  const model: NoiseModel = seed % 2 ? "poisson" : "overdispersed";
  const f = frameOf(TODAY, HISTORY_MONTHS);
  const credit = CREDIT[seed % CREDIT.length]!;
  const link = LINKS[seed % LINKS.length]!;
  // not the seed's remainder by 5 again, so each pay day case meets each credit case
  const payday = PAYDAYS[Math.floor(seed / 4) % PAYDAYS.length]!;
  // the facts of the story: consumer credits opened in the last 180 days (the draw of the link cases is one) and running today (the card too)
  const opened = { stack: 3, "old-lines": 0, "one-new": 1, "late-second": 1, none: 0 }[credit] + (link === "none" ? 0 : 1);
  const running = 1 + { stack: 3, "old-lines": 3, "one-new": 1, "late-second": 2, none: 0 }[credit] + (link === "none" ? 0 : 2);
  const truth: Truth = { credit, stacked: opened >= 2 && running >= 3, link, linkDraws: new Set(), payday, paydaySpike: payday === "spike" || payday === "moderate", splits: new Set(), exactSplits: new Set(), priceRises: new Set(), stakes: new Set(), sharedStakes: new Set() };
  const planted = [...creditRows(f, credit), ...linkRows(f, link, truth), ...paydayRows(f, payday, seed), ...splitRows(f, seed, truth), ...priceRows(f, truth), ...gamblingRows(f, seed, truth)];
  // five households linked the card five months ago (one with a pay day spike): the bills before are the same card, no
  // second credit, and the spike has too few covered cycles to be told
  const late = LATE_CARD.has(seed);
  const txs = withCardBills([...steadyRows(seed, model, TODAY), ...planted], TODAY).filter((t) => !late || !cardConnectedLate.drop!(t, f));
  return { household: householdOf(`accuracy:${seed}:${credit}:${link}:${payday}${late ? ":card-late" : ""}`, TODAY, txs), truth };
}

/** A steady household with nothing planted: every claim on it is false. */
export function steadyLabelled(seed: number): Labelled {
  const model: NoiseModel = seed % 2 ? "poisson" : "overdispersed";
  const truth: Truth = { credit: "none", stacked: false, link: "none", linkDraws: new Set(), payday: "none", paydaySpike: false, splits: new Set(), exactSplits: new Set(), priceRises: new Set(), stakes: new Set(), sharedStakes: new Set() };
  return { household: householdOf(`steady:${seed}`, TODAY, withCardBills(steadyRows(seed, model, TODAY), TODAY)), truth };
}

const monthly = (f: Frame, fromAgo: number, toAgo: number, day: number, make: (date: string, i: number) => void) => {
  for (let back = fromAgo, i = 0; back >= toAgo; back--, i++) make(f.on(f.ago(back), day), i);
};

/** Consumer credit lines: new ones in the last half year, old ones from the start of the history, or one new car loan. */
function creditRows(f: Frame, c: CreditCase): Transaction[] {
  const { out, add } = rows("credit", f.today);
  const svea = (from: number) => monthly(f, from, 0, 15, (date) => add({ date, cents: -4_600, counterparty: "SVEA BANK AB", description: "LAINAN LYHENNYS 7781234" }));
  const resurs = (from: number) => monthly(f, from, 0, 20, (date) => add({ date, cents: -21_580, counterparty: "RESURS BANK AB", description: "LASKU 5521" }));
  const klarna = (from: number) => monthly(f, from, 0, 3, (date) => add({ date, cents: -3_333, counterparty: "KLARNA BANK AB", description: "OSAMAKSU 99812" }));
  if (c === "stack") {
    svea(5);
    resurs(3);
    klarna(2);
  } else if (c === "old-lines") {
    svea(HISTORY_MONTHS);
    resurs(HISTORY_MONTHS);
    monthly(f, HISTORY_MONTHS, 0, 22, (date, i) => add({ date, cents: -(8_000 + (i % 5) * 1_100), counterparty: "MORROW BANK ASA", description: "KORTTILASKU" }));
  } else if (c === "one-new") {
    monthly(f, 4, 0, 10, (date) => add({ date, cents: -21_500, counterparty: "SANTANDER CONSUMER FINANCE OY", description: "AUTOLAINA 5551 LYHENNYS" }));
  } else if (c === "late-second") {
    // two new lines, but the first is eight months old: one new line in the last half year
    svea(8);
    resurs(2);
  }
  // a single 30-day invoice and its refund: no credit line
  add({ date: f.on(f.ago(6), 4), cents: -5_990, counterparty: "KLARNA BANK AB", description: "LASKU 30 PV" });
  add({ date: f.on(f.ago(6), 12), cents: 5_990, counterparty: "KLARNA BANK AB", description: "HYVITYS" });
  return out;
}

/** Credit drawn and spent at once on other credit, or drawn for a purchase. */
function linkRows(f: Frame, l: LinkCase, truth: Truth): Transaction[] {
  const { out, add } = rows("link", f.today);
  if (l === "none") return out;
  // a card of another bank paid every month from the start, so the extra payment has a usual one to stand out from
  monthly(f, HISTORY_MONTHS, 0, 18, (date) => add({ date, cents: -15_000, counterparty: "BANK NORWEGIAN ASA", description: "LASKU 66120" }));
  const drawDay = f.on(f.ago(1), 3);
  add({ date: drawDay, cents: 200_000, counterparty: "TF BANK AB", description: "LUOTON NOSTO 3341" });
  truth.linkDraws.add(out[out.length - 1]!.id);
  if (l === "pays-credit") add({ date: addDays(drawDay, 4), cents: -190_000, counterparty: "BANK NORWEGIAN ASA", description: "LASKU 66120" });
  else {
    truth.linkDraws.clear();
    add({ date: addDays(drawDay, 2), cents: -180_000, counterparty: "AUTOLIIKE ESIMERKKI OY", description: "AUTOKAUPPA ABC-123" });
  }
  monthly(f, 0, 0, 25, (date) => add({ date, cents: -9_000, counterparty: "TF BANK AB", description: "LYHENNYS 3341" }));
  return out;
}

/**
 * Spending around pay day in the last eight cycles: a strong spike (eight extra purchases in the four days), a moderate
 * one (three, a real effect that a year of one card purchase a day cannot tell from chance), a mild one (one, no
 * effect to tell), or bills and a big purchase that fall on it.
 */
function paydayRows(f: Frame, p: PaydayCase, seed: number): Transaction[] {
  const { out, add } = rows("payday", f.today);
  const shops = [
    { text: "RAVINTOLA KUUSI HELSINKI", mcc: "5812" },
    { text: "STOCKMANN HELSINKI", mcc: "5311" },
    { text: "ALKO HELSINKI KAMPPI", mcc: "5921" },
    { text: "ZALANDO SE BERLIN DE", mcc: "5651" },
  ];
  for (let back = 8; back >= 1; back--) {
    const pay = banking(f.on(f.ago(back), 25), addDays);
    if (p === "spike" || p === "moderate") {
      for (let k = 0; k < (p === "spike" ? 8 : 3); k++) {
        const s = shops[(k + back + seed) % shops.length]!;
        add({ date: addDays(pay, k % 4), cents: -(3_500 + ((k * 1_700 + back * 900 + seed * 300) % 4_000)), description: s.text, mcc: s.mcc, account: "card" });
      }
    } else if (p === "mild") {
      const s = shops[(back + seed) % shops.length]!;
      add({ date: addDays(pay, 1), cents: -3_000, description: s.text, mcc: s.mcc, account: "card" });
    } else if (p === "bills-on-payday") {
      add({ date: addDays(pay, 1), cents: -(8_500 + back * 1_900), counterparty: "HAMMASLAAKARIASEMA ESIMERKKI OY", description: "LASKU" });
      out[out.length - 1]!.reference = `RF18${5390 + back}`;
      if (back === 3) add({ date: pay, cents: -94_900, description: "VERKKOKAUPPA.COM HELSINKI", mcc: "5732", account: "card" });
    }
  }
  return out;
}

const personIn = (add: ReturnType<typeof rows>["add"], date: string, cents: number, who: string) => add({ date, cents, counterparty: who, description: "MOBILEPAY" });

/** Shared purchases in the last 80 days with the friends' payments, real misses, and money from people that is no share. */
function splitRows(f: Frame, seed: number, truth: Truth): Transaction[] {
  const { out, add } = rows("split", f.today);
  const start = dayNumber(f.today) - 80;
  const on = (k: number) => {
    let d = fromDayNumber(start + k);
    while (weekdayOf(d) > 4) d = addDays(d, 1);
    return d;
  };
  const who = (k: number) => FRIENDS[(k + seed) % FRIENDS.length]!;
  const purchase = (date: string, cents: number, text: string, mcc: string) => {
    add({ date, cents: -cents, description: text, mcc, account: "card" });
    truth.splits.add(out[out.length - 1]!.id);
  };
  // a court, two friends round their shares down: the strict rule misses it, the question asks
  let d = on(2 + (seed % 3));
  purchase(d, 2_200, "SULKAPALLOHALLI ESIMERKKI HELSINKI", "7997");
  personIn(add, addDays(d, 1), 600, who(0));
  personIn(add, addDays(d, 2), 600, who(1));
  // a dinner for three paid back exactly: the strict rule nets it
  d = on(16);
  purchase(d, 3_000, "RAVINTOLA SAVOTTA HELSINKI", "5812");
  truth.exactSplits.add(out[out.length - 1]!.id);
  personIn(add, addDays(d, 1), 1_000, who(2));
  personIn(add, addDays(d, 1), 1_000, who(3));
  // a cottage weekend's groceries, half paid back
  d = on(30);
  purchase(d, 6_438, "K-SUPERMARKET NUUKSIO ESPOO", "5411");
  personIn(add, addDays(d, 3), 3_219, who(4));
  // real splits no rule should claim to see: one friend paid 70 %, two paid after ten days
  d = on(44);
  purchase(d, 4_000, "FINNKINO TENNISPALATSI HELSINKI", "7832");
  personIn(add, addDays(d, 2), 2_800, who(5));
  d = on(58);
  purchase(d, 2_400, "SULKAPALLOHALLI ESIMERKKI HELSINKI", "7997");
  personIn(add, addDays(d, 10), 800, who(6));
  personIn(add, addDays(d, 11), 800, who(7));

  // a stake put in together: 100 € to Veikkaus and three friends' 25 € the same day and the next
  d = on(70);
  purchase(d, 10_000, "VEIKKAUS OY HELSINKI", "7995");
  truth.stakes.add(out[out.length - 1]!.id);
  truth.sharedStakes.add(out[out.length - 1]!.id);
  personIn(add, d, 2_500, who(1));
  personIn(add, d, 2_500, who(3));
  personIn(add, addDays(d, 1), 2_500, who(5));
  // a stake and one friend's round 20 € the next day, an old debt paid back: no share
  d = on(74);
  add({ date: d, cents: -4_000, description: "VEIKKAUS OY HELSINKI", mcc: "7995", account: "card" });
  truth.stakes.add(out[out.length - 1]!.id);
  personIn(add, addDays(d, 1), 2_000, who(2));

  // payment services pay shops and brokers far more often than casinos (owner): a group gift bought through Trustly and
  // shared by three is a split and no stake; a deposit to a broker through Trustly is shared with nobody
  d = on(62);
  add({ date: d, cents: -9_000, counterparty: "TRUSTLY GROUP AB", description: "VERKKOKAUPPA ESIMERKKI LAHJA" });
  truth.splits.add(out[out.length - 1]!.id);
  personIn(add, addDays(d, 1), 2_200, who(0));
  personIn(add, addDays(d, 1), 2_200, who(4));
  d = on(66);
  add({ date: d, cents: -20_000, counterparty: "TRUSTLY GROUP AB", description: "NORDNET BANK AB TALLETUS" });
  personIn(add, addDays(d, 1), 5_000, who(6));
  personIn(add, addDays(d, 2), 5_000, who(7));

  // money from people that shares nothing: a grandparent's weekly 20 €, gifts and sales on random days
  for (let k = 0; k < 11; k++) personIn(add, fromDayNumber(start + 3 + k * 7), 2_000, "MAIJA MEIKALAINEN");
  for (let k = 0; k < 14; k++) {
    const amount = [1_000, 1_500, 2_000, 2_500, 3_000, 4_000, 5_000][(k * 3 + seed) % 7]!;
    personIn(add, fromDayNumber(start + 1 + ((k * 13 + seed * 7) % 78)), amount, `ERKKI ${FRIENDS[(k * 5 + seed) % FRIENDS.length]!.split(" ")[1]}`);
  }
  return out;
}

/** A streaming price that rose three months ago, and decoys: a double charge once, a small currency wobble. */
function priceRows(f: Frame, truth: Truth): Transaction[] {
  const { out, add } = rows("price", f.today);
  monthly(f, 20, 0, 7, (date, i) => add({ date, cents: i < 18 ? -899 : -1_199, description: "DISNEY PLUS AMSTERDAM NL", mcc: "4899", account: "card" }));
  truth.priceRises.add(fold(normalizeMerchant(null, "DISNEY PLUS AMSTERDAM NL")));
  monthly(f, 20, 0, 9, (date, i) => add({ date, cents: i === 15 ? -2_998 : -1_499, description: "VIAPLAY STOCKHOLM SE", mcc: "4899", account: "card" }));
  monthly(f, 20, 0, 16, (date, i) => add({ date, cents: -(1_000 + (i % 3) * 20), description: "OPENAI *CHATGPT SUBSCR SAN FRANCISCO US", mcc: "5734", account: "card" }));
  return out;
}

/** Stakes on a licensed brand and on an offshore operator under its legal name; a bar called casino and a web shop paid through an intermediary. */
function gamblingRows(f: Frame, seed: number, truth: Truth): Transaction[] {
  const { out, add } = rows("gambling", f.today);
  if (seed % 2) {
    for (let k = 0; k < 6; k++) {
      add({ date: f.on(f.ago(k), 6 + k), cents: -(1_000 + k * 500), description: "VEIKKAUS OY HELSINKI", mcc: "7995", account: "card" });
      truth.stakes.add(out[out.length - 1]!.id);
    }
  } else {
    for (let k = 0; k < 6; k++) {
      add({ date: f.on(f.ago(k), 8 + k), cents: -(2_000 + k * 1_000), counterparty: "PELIKASINO HOLDINGS LTD", description: "MALTA" });
      truth.stakes.add(out[out.length - 1]!.id);
    }
  }
  add({ date: f.on(f.ago(2), 20), cents: -3_800, description: "CASINO BAR HELSINKI", mcc: "5813", account: "card" });
  add({ date: f.on(f.ago(3), 21), cents: -4_900, counterparty: "TRUSTLY GROUP AB", description: "VERKKOKAUPPA ESIMERKKI" });
  return out;
}
