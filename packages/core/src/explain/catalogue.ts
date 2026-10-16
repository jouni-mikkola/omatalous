import type { Reason, RuleId } from "./types.ts";

const SOURCES: Record<string, string> = {
  rule: "Luokka tuli sovelluksen säännöstä",
  mcc: "Luokka tuli kortin toimialakoodista",
  merchant: "Luokka tuli saman kauppiaan muista tapahtumista",
  industry: "Luokka tuli kauppiaan toimialasta",
  default: "Luokkaa ei tunnistettu",
};

const fraction = (r: Reason) => `${Number(r.to) - Number(r.from)}/${r.of}`;

/** The Finnish sentence of each rule, with the numbers of the reason in it. */
const CATALOGUE: Record<RuleId, (r: Reason) => string> = {
  "category.hand": () => "Luokan valitsit itse",
  "category.own_rule": () => "Luokka tuli omasta säännöstäsi",
  "category.builtin": (r) => SOURCES[String(r.source)] ?? SOURCES.default!,
  "transfer.pair": (r) => (r.people ? "Rahaa ihmisten välillä" : "Siirto tilien välillä, ei menoa eikä tuloa"),
  "transfer.channel": () => "Kortin laskun maksu, ostokset lasketaan kortin omista tapahtumista",
  "card.bill": () => "Kortin lasku, jonka ostoksia ei ole tiedoissa: lasku lasketaan menoksi",
  "return.shop": () => "Kaupan palautus ostoon",
  "return.person": () => "Maksu tuli takaisin samalta henkilöltä",
  "return.share": () => "Toisen osuus yhteisestä maksusta",
  "refund.net": (r) => (Number(r.months) === 0 ? "Palautus pienentää saman kuukauden ostoa" : `Palautus pienentää ${r.months} kuukautta aiemmin tehtyä ostoa`),
  "part.use": (r) => `Osuutesi on ${fraction(r)} tilin rahoista`,
  "part.source": (r) => (r.mine ? "Tämä osa oli omaa rahaasi" : "Tämä osa oli toisen rahaa"),
  "role.payer": () => "Maksajan rooli on sinun vastauksesi",
  "settle.paid": () => "Maksoit tämän itse",
  "settle.owed": () => "Osuutesi tästä tapahtumasta",
  "settle.refund": () => "Palautus jaettiin ostoksen osuuksien mukaan",
  "settle.credit_filled": () => "Myöhempi talletus kattoi aiemman maksun",
  "settle.unknown": () => "Maksajaa ei tiedetä",
  "settle.open": () => "Kuukausi on auki",
  "settle.closed": () => "Kuukausi on suljettu",
  "agree.dated": (r) => `Sopimus on voimassa ${r.valid_from} alkaen`,
  "rounding.cent": () => "Jakamaton sentti menee ensimmäiselle tunnukselle",
};

export const sentenceOf = (r: Reason): string => CATALOGUE[r.rule](r);
