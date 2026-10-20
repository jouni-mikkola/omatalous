/**
 * Gambling told by its operators, its words, its merchant codes and the payment services that carry its money: the
 * part of the bank dialect (ADR 0008) behind the category Rahapelit and the refusal of the trade register. The lists
 * ship with the app and are never fetched: no install tells anyone which operators it matched. A household adds an
 * operator of its own with a user rule.
 *
 * Every entry names its source: the licence register (Veikkaus and Fintoto under the Lotteries Act, Paf under Åland's
 * own licence) or the operator's own site, which names the company behind its brands. The Police Board's list of
 * operators whose payments the banks block is the next source to check an entry against. A row may name only the company, so both are here.
 */
import { words } from "./wording.ts";

/** Licence holders of mainland Finland and Åland, and the games a row names them by. */
const LICENSED = [
  "VEIKKAUS", // licence register, Veikkaus Oy
  "FINTOTO", // licence register, Fintoto Oy (horse betting, from 2027)
  "PAF", // Ålands landskapsregering, Ålands Penningautomatförening
  "ALANDS PENNINGAUTOMATFORENING", // the same, its legal name
];

/** Operators that market to Finns without a Finnish licence, by brand and by the company behind the brand. */
const OFFSHORE = [
  "UNIBET", // unibet.fi
  "TRANNEL INTERNATIONAL", // unibet.fi, the company behind Unibet
  "BETSSON", // betsson.com
  "NORDICBET", // betsson.com, a Betsson brand
  "BETSAFE", // betsson.com, a Betsson brand
  "BML GROUP", // betsson.com, the company behind Betsson, NordicBet and Betsafe
  "LEOVEGAS", // leovegas.com, LeoVegas Gaming plc
  "COOLBET", // coolbet.com
  String.raw`MR ?GREEN`, // mrgreen.com, Mr Green Limited
  "CASUMO", // casumo.com, Casumo Services Limited
  "VIDEOSLOTS", // videoslots.com, Videoslots Ltd
  "SPEEDYBET", // speedybet.com
  "POKERSTARS", // pokerstars.com
  "BETWAY", // betway.com, Betway Limited
  "BETFAIR", // betfair.com
  "COMEON", // comeon.com
  "PROZONE", // supernopea.com, Prozone Limited runs SuperNopea, Bethard and TurboVegas
  "SUPERNOPEA", // supernopea.com
  "BETHARD", // bethard.com
  "TURBOVEGAS", // turbovegas.com
  "ROOTZ", // wildz.com, Rootz Limited runs Wildz and Caxino
  "WILDZ", // wildz.com
  "CAXINO", // caxino.com
  "SKILL ON NET", // playojo.com, Skill On Net Ltd runs PlayOJO
  "PLAYOJO", // playojo.com
  "KOLIKKOPELIT", // kolikkopelit.com
  "BET365", // bet365.com
  "HILLSIDE NEW MEDIA", // bet365.com, Hillside (New Media Malta) Plc runs Bet365's casino
  "HILLSIDE SPORTS", // bet365.com, Hillside (Sports) ENC runs Bet365's betting
  "NETBET", // netbet.com
  "1XBET", // 1xbet.com
];

/**
 * Words of gambling and the names of Veikkaus's games, in a compound (Pelikasino) and inflected (Pokerin). A word
 * alone is weaker than an operator: a bar is named Casino, a pizzeria Keno or Bingo, so the word needs a card payment
 * and yields to a merchant code of another category (categorize.ts).
 */
const WORDS = [
  String.raw`[A-Z]*KASINO[A-Z]*`, // Finnish
  String.raw`[A-Z]*CASINO[A-Z]*`, // English, Swedish
  "BET", // English, in operators' names
  "SLOTS", // English
  "SPINS", // English, free spins
  String.raw`[A-Z]*POKER[A-Z]*`, // Finnish (pokeri) and English
  String.raw`KOLIKKOPELI[A-Z]*`, // Finnish, slot machines
  "BINGO", // Finnish and English
  String.raw`VEDONLYONTI[A-Z]*`, // Finnish, betting
  String.raw`RAHAPELI[A-Z]*`, // Finnish, gambling
  "EUROJACKPOT", // veikkaus.fi, a Veikkaus game
  "LOTTO", // veikkaus.fi
  "TOTO", // veikkaus.fi
  "KENO", // veikkaus.fi
];

/**
 * Payment services that carry money to and from operators. Each also pays tax refunds, insurance claims and shop
 * refunds, so a row of one alone is no evidence of gambling. Siirto is never here: it is the banks' own payment between
 * people.
 */
const INTERMEDIARIES = [
  "ZIMPLER", // zimpler.com, Pay N Play deposits and payouts
  "TRUSTLY", // trustly.com, Pay N Play deposits and payouts
  "BRITE", // britepayments.com, instant deposits and payouts
  "PAYSAFECARD", // paysafecard.com, prepaid vouchers
  "PAYSAFE", // paysafe.com, the company behind Paysafecard, Skrill and Neteller
  "SKRILL", // skrill.com, e-wallet
  "NETELLER", // neteller.com, e-wallet
  "SOFORT", // sofort.com, bank payment
  "MUCHBETTER", // muchbetter.com, e-wallet
  "EUTELLER", // euteller.com, bank payment
];

/** Merchant codes of gambling (ISO 18245): lotteries and government-owned ones, horse and dog racing, betting and casino chips. */
export const GAMBLING_MCC: readonly number[] = [7800, 7801, 7802, 7995, 9406];

// a digit may follow a name: a brand is written with one (Bet365) or a site's number is added to it
const OPERATOR = words([...LICENSED, ...OFFSHORE].join("|"), true);
const WORD = words(WORDS.join("|"), true);
const INTERMEDIARY = words(INTERMEDIARIES.join("|"), true);

/** An operator or a word of gambling in a folded text: the pattern the merchant rules of categorize.ts test a message with. */
export const GAMBLING_NAME = new RegExp(`${OPERATOR.source}|${WORD.source}`);

/** A folded text that names a gambling operator: evidence on its own, whatever the merchant code. */
export const isGamblingOperator = (folded: string) => OPERATOR.test(folded);

/** A folded text with a word of gambling or a game's name. Alone it is evidence only on a card payment no other merchant code speaks for. */
export const isGamblingWord = (folded: string) => WORD.test(folded);

/** A folded name of a payment service that carries gambling money. Never evidence by itself. */
export const isGamblingIntermediary = (folded: string) => INTERMEDIARY.test(folded);

/** Whether a merchant code is one of gambling. */
export const isGamblingMcc = (mcc: string | null | undefined) => !!mcc && GAMBLING_MCC.includes(Number.parseInt(mcc, 10));
