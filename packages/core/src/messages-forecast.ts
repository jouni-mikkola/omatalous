/**
 * The catalogue of the longer forecast: the next twelve months and the net worth over the years, in Raportit > Saldot ja
 * nettovarat. Same shape as the tables of `messages.ts` (a Finnish table gives the codes, the English one must have the
 * same codes and holes) and the same test.
 * Decision: the household reads in its own language how wide the range of its coming months is and what it rests on.
 */
export const FI_FORECAST = {
  "forecast.title": "Seuraavat 12 kuukautta",
  "forecast.question": "Säästöön jäävä raha seuraavien 12 kuukauden aikana",
  "forecast.none": "Emme voi vielä ennustaa: tarvitsemme vähintään {min} päättynyttä kuukautta tilien rivejä.",
  "forecast.answer": "Sinulle jää seuraavien 12 kuukauden aikana säästöön noin {mid}. Se voi olla {low}–{high}.",
  "forecast.answer_worth": " Velkojesi jälkeen varasi ovat silloin noin {mid}, ja se voi olla {low}–{high}.",
  "forecast.basis": "Arvio perustuu viime {months} kuukauteesi. Laskimme {runs} kertaa, paljonko sinulle voisi jäädä tulevina kuukausina, kun tulosi ja menosi vaihtelevat samalla tavalla kuin ennenkin. Alin ja ylin arvio rajaavat sen, mihin yhdeksän laskelmaa kymmenestä osuu. Kun kokeilimme tapaa testidatalla, oikea kuukausi osui välille vähintään 80 %:ssa kuukausista. Emme tiedä tulevia isoja ostoja, palkankorotuksia emmekä laskujen hinnanmuutoksia.",
  "forecast.chart": "Varat velkojen jälkeen vuosien yli",
  "forecast.chart_total": "Säästösi vuosien yli",
  "forecast.chart_answer": "Viiden vuoden päästä sinulla on velkojen jälkeen noin {mid}, ja se voi olla {low}–{high}.",
  "forecast.chart_answer_total": "Viiden vuoden päästä olet säästänyt noin {mid}. Se voi olla {low}–{high}.",
  "forecast.chart_label": "Arvio kehityksestä ja sen vaihtelusta kuukausittain, 5 vuotta eteenpäin. Nuolinäppäimillä siirryt kuukaudesta toiseen.",
  "forecast.legend_mid": "Arvio",
  "forecast.legend_range": "Alin ja ylin arvio",
  "forecast.caption_months": "Seuraavat 12 kuukautta",
  "forecast.caption_years": "Vuodet eteenpäin",
  "forecast.col_month": "Kuukausi",
  "forecast.col_year": "Aika",
  "forecast.col_low": "Alin",
  "forecast.col_mid": "Arvio",
  "forecast.col_high": "Ylin",
  "forecast.col_saving": "Jää",
  "forecast.col_total": "Säästöä yhteensä",
  "forecast.col_worth": "Varat",
  "forecast.years_ahead": "Vuosi {n}",
} as const;
