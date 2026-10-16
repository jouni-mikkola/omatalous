import { MIN_COMPARE_MONTHS, USUAL_MONTHS } from "../analysis/usual.ts";
import { USUAL_INCOME_MONTHS } from "../reports/income.ts";
import type { Reason, RuleId } from "./types.ts";

const SOURCES: Record<string, string> = {
  rule: "Luokiteltu automaattisesti",
  mcc: "Luokiteltu kaupan toimialakoodin mukaan",
  merchant: "Luokiteltu saman kaupan aiempien ostojen mukaan",
  industry: "Luokiteltu kaupan toimialan mukaan",
  default: "Ei luokiteltu",
};

/** An ISO date as d.m.yyyy. */
const fiDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${Number(d)}.${Number(m)}.${y}` : iso;
};

const fraction = (r: Reason) => `${Number(r.to) - Number(r.from)}/${r.of}`;

/** The Finnish sentence of each rule, with the numbers of the reason in it. */
const CATALOGUE: Record<RuleId, (r: Reason) => string> = {
  "category.hand": () => "Valitsit luokan itse",
  "category.own_rule": () => "Luokiteltu oman sääntösi mukaan",
  "category.builtin": (r) => SOURCES[String(r.source)] ?? SOURCES.default!,
  "transfer.pair": (r) => (r.people ? "Rahansiirto henkilöiden välillä" : "Oma tilisiirto, ei lasketa menoihin eikä tuloihin"),
  "transfer.channel": () => "Luottokortin laskun maksu. Ostokset näkyvät kortin omina tapahtumina, joten maksua ei lasketa menoksi.",
  "card.bill": () => "Luottokortin lasku. Kortin ostoksia ei ole saatavilla, joten koko lasku lasketaan menoksi.",
  "return.shop": () => "Palautus kaupasta",
  "return.person": () => "Sama henkilö maksoi rahat takaisin",
  "return.share": () => "Toisen osuus yhteisestä ostoksesta",
  "refund.net": (r) => (Number(r.months) === 0 ? "Palautus vähennetty saman kuukauden ostosta" : Number(r.months) === 1 ? "Palautus vähennetty edellisen kuukauden ostosta" : `Palautus vähennetty ostosta, joka tehtiin ${r.months} kuukautta aiemmin`),
  "part.use": (r) => `Osuutesi tilin rahoista on ${fraction(r)}`,
  "part.source": (r) => (r.mine ? "Tämä osa maksettiin sinun rahoistasi" : "Tämä osa maksettiin toisen rahoista"),
  "role.payer": () => "Kerroit itse, mitä tämän maksajan maksut ovat",
  "settle.paid": () => "Maksoit tämän itse",
  "settle.owed": () => "Osuutesi tästä maksusta",
  "settle.refund": () => "Palautus jaettiin samoin kuin ostos",
  "settle.credit_filled": () => "Myöhemmin tilille tullut raha kattoi tämän maksun",
  "settle.unknown": () => "Maksaja ei ole tiedossa",
  "settle.open": () => "Kuukausi on vielä kesken",
  "settle.closed": () => "Kuukausi on lukittu",
  "agree.dated": (r) => `Sopimus on voimassa ${fiDate(String(r.valid_from))} alkaen`,
  "rounding.cent": () => "Pyöristyksestä jäänyt sentti on merkitty ensimmäiselle käyttäjälle",
};

export const sentenceOf = (r: Reason): string => CATALOGUE[r.rule](r);

/** How a usual level is found: the months it reads and how an even count is settled. */
export const medianRule = (): string => `Laskettu edellisistä täysistä kuukausista (enintään ${USUAL_MONTHS})`;
/** The page's usual income: a median of the report's twelve months, each the regular income of its pay period. */
export const incomeRule = (): string => `Säännölliset tulot ${USUAL_INCOME_MONTHS} viimeiseltä täydeltä kuukaudelta`;
export const medianTie = (count: number): string => (count % 2 ? "Mediaani eli keskimmäinen kuukausi" : "Mediaani eli kahden keskimmäisen kuukauden keskiarvo");
/** What a usual level says when the months are too few for one. */
export const tooFewMonths = (count: number, needed: number = MIN_COMPARE_MONTHS): string => `Vertailuun tarvitaan ${needed} kuukautta, tietoja on ${count}`;
