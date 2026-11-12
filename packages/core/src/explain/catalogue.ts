import { formatEur, formatFiDate } from "../analysis/format.ts";
import { DIRECTION_MONTHS, MIN_COMPARE_MONTHS, PERIODIC_MONTHS, USUAL_MONTHS } from "../thresholds.ts";
import type { Reason, RuleId } from "./types.ts";

const SOURCES: Record<string, string> = {
  rule: "Luokiteltu automaattisesti",
  mcc: "Luokiteltu kaupan toimialakoodin mukaan",
  merchant: "Luokiteltu saman kaupan aiempien ostojen mukaan",
  industry: "Luokiteltu kaupan toimialan mukaan",
  default: "Ei luokiteltu",
};

const fraction = (r: Reason) => `${Number(r.to) - Number(r.from)}/${r.of}`;

/** The Finnish sentence of each rule, with the numbers of the reason in it. */
const CATALOGUE: Record<RuleId, (r: Reason) => string> = {
  "category.hand": () => "Valitsit kategorian itse",
  "category.own_rule": () => "Luokiteltu oman sääntösi mukaan",
  "category.builtin": (r) => SOURCES[String(r.source)] ?? SOURCES.default!,
  "transfer.pair": (r) => (r.people ? "Rahansiirto henkilöiden välillä" : "Oma tilisiirto, ei lasketa menoihin eikä tuloihin"),
  "transfer.channel": () => "Luottokortin laskun maksu. Ostokset näkyvät kortin omina tapahtumina, joten maksua ei lasketa menoksi.",
  "card.bill": () => "Luottokortin lasku. Kortin ostoja ei näy, joten laskemme laskun velanhoitoon.",
  "return.shop": () => "Palautus kaupasta",
  "return.person": () => "Sama henkilö maksoi rahat takaisin",
  "return.share": () => "Toisen osuus yhteisestä ostoksesta",
  // the page puts the purchase's shop in `shop`: a reason holds ids and days, no names
  "return.wallet": (r) => `Osuus ostoksesta ${r.shop ? `${r.shop} ` : ""}${formatFiDate(String(r.day))}`,
  "share.back": (r) => `Takaisin saatu ${formatEur(Number(r.cents))} (${Number(r.count) === 1 ? "1 maksu" : `${r.count} maksua`})`,
  "share.open": () => "Osuus yhteisistä ostoista",
  "via.service": (r) => `Maksettu palvelun ${r.service} kautta`,
  "refund.net": (r) => (Number(r.months) === 0 ? "Vähensimme palautuksen saman kuukauden ostosta" : Number(r.months) === 1 ? "Vähensimme palautuksen edellisen kuukauden ostosta" : `Vähensimme palautuksen ostosta, joka tehtiin ${r.months} kuukautta aiemmin`),
  "part.use": (r) => `Osuutesi tilin rahoista on ${fraction(r)}`,
  "part.source": (r) => (r.mine ? "Maksoit tämän osan omista rahoistasi" : "Toinen maksoi tämän osan omista rahoistaan"),
  "role.payer": () => "Kerroit itse, mitä tämän maksajan maksut ovat",
  "settle.paid": () => "Maksoit tämän itse",
  "settle.owed": () => "Osuutesi tästä maksusta",
  "settle.refund": () => "Jaoimme palautuksen samoin kuin ostoksen",
  "settle.credit_filled": () => "Myöhemmin tilille tullut raha kattoi tämän maksun",
  "settle.unknown": () => "Maksaja ei ole tiedossa",
  "settle.open": () => "Kuukausi on vielä kesken",
  "settle.closed": () => "Kuukausi on lukittu",
  "agree.dated": (r) => `Sopimus on voimassa ${formatFiDate(String(r.valid_from))} alkaen`,
  "rounding.cent": () => "Pyöristyksestä jäänyt sentti on merkitty ensimmäiselle käyttäjälle",
};

export const sentenceOf = (r: Reason): string => CATALOGUE[r.rule](r);

/** The months the expected month reads. */
export const expectedRule = (): string => `Laskettu edellisistä päättyneistä kuukausista (enintään ${USUAL_MONTHS})`;
/** The months Yhteenveto's average spending reads, and how they make it. */
export const averageRule = (): string => `Laskettu edellisistä päättyneistä kuukausista (enintään ${DIRECTION_MONTHS})`;
export const averageHow = (): string => "Keskiarvo kuukausien menoista";
/** How the listed months make the figure: a category at a time, not the months' totals. */
export const expectedHow = (): string =>
  `Odotettu on kategorioiden odotettujen menojen summa. Laskemme jokaisesta kategoriasta kuukausien keskiarvon, ${PERIODIC_MONTHS} kuukauden välein tai harvemmin tulevat laskut ovat omassa kuukaudessaan ja kertaostot jäävät pois`;
/** The page's usual income: a median of the report's months, each the regular income of its pay period. */
export const incomeRule = (): string => `Säännölliset tulot viimeisiltä valmiilta kuukausilta (enintään ${USUAL_MONTHS})`;
export const medianTie = (count: number): string => (count % 2 ? "Mediaani eli keskimmäinen kuukausi" : "Mediaani eli kahden keskimmäisen kuukauden keskiarvo");
/**
 * The pay the window waits for, as the page says it: a steady pay by the median of its pays, one that varies by the range
 * from the quarter of the pays below to the quarter above; and the month of earlier years that moved it.
 */
export const payRule = (count: number, steady: boolean, season: boolean): string =>
  `${steady ? `Arvio on ${count} viimeisimmän palkan mediaani` : `Arvion alaraja on summa, jota pienempiä on ollut neljännes ${count} viimeisimmästä palkasta, ja yläraja summa, jota suurempia on ollut neljännes`}${season ? ". Saman kuun palkka on aiempina vuosina poikennut muista, ja arvio ottaa sen huomioon" : ""}`;
/** What a usual level says when the months are too few for one. */
export const tooFewMonths = (count: number, needed: number = MIN_COMPARE_MONTHS): string => `Vertailuun tarvitsemme ${needed} kuukautta, tietoja on ${count}`;
