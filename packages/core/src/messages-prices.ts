/**
 * The catalogue of the price-change comparison: the household's own fixed prices against the consumer price index, in
 * Raportit > Kiinteät menot. Same shape as the tables of `messages.ts` (a Finnish table gives the codes,
 * the English one must have the same codes and holes) and the same test.
 * Decision: the household reads in its own language whether its prices rose faster than prices in general, and how to
 * get the comparison when the published series is missing.
 */
export const FI_PRICES = {
  "prices.title": "Omat hinnat ja kuluttajahintaindeksi",
  "prices.question": "Kiinteiden hintojen nousu",
  "prices.off": "Hintavertailua ei ole vielä käytössä. Ylläpitäjä voi ottaa sen käyttöön kohdassa Asetukset > Palvelin ja ylläpito. Silloin palvelin hakee Tilastokeskuksen julkisen indeksisarjan eikä lähetä mitään talouden tiedoista.",
  "prices.short": "Emme voi vertailla: indeksisarjasta puuttuu kuukausia {from}–{to}. Sarja päivittyy kerran päivässä.",
  "prices.no_basket": "Emme voi vertailla: sinulla ei ole kiinteähintaista tilausta, joka olisi maksanut jo kuussa {month}.",
  "prices.answer_more": "Hintasi kallistuivat yleistä hintatasoa enemmän. Kiinteiden hintojesi kori muuttui {own} kuukausista {from}–{to}, kuluttajahintaindeksi {index}. Indeksiin suhteutettuna hintasi ovat {gap} korkeammat kuin alussa.",
  "prices.answer_less": "Hintasi kallistuivat yleistä hintatasoa vähemmän. Kiinteiden hintojesi kori muuttui {own} kuukausista {from}–{to}, kuluttajahintaindeksi {index}. Indeksiin suhteutettuna hintasi ovat {gap} matalammat kuin alussa.",
  "prices.answer_same": "Hintasi muuttuivat yhtä paljon kuin yleinen hintataso. Kiinteiden hintojesi kori muuttui {own} kuukausista {from}–{to}, kuluttajahintaindeksi {index}.",
  "prices.basis": "Oma sarja on kiinteähintaisten kulujesi kori: jokaisen tilauksen silloin voimassa ollut hinta kertaa sen veloitukset kuukaudessa. Mukana ovat vain tilaukset, jotka ovat maksaneet jo kuussa {month} ja jatkuvat edelleen. Määrät pysyvät samoina, joten sarjaa liikuttaa vain hinta. Alle 0,50 euron tai alle 3 prosentin nousu ei näy, koska Kiinteät menot -sivu käyttää samaa rajaa hinnanmuutoksille. Vertailusarja on kuluttajahintaindeksi, lähde {source}, taulukko {table}, haettu {date}.",
  "prices.caption_months": "Oma hintasarja ja kuluttajahintaindeksi kuukausittain",
  "prices.caption_services": "Korin tilaukset ja niiden hinnat",
  "prices.col_month": "Kuukausi",
  "prices.col_own": "Oma sarja",
  "prices.col_index": "Indeksi",
  "prices.col_relative": "Oma sarja jaettuna indeksillä",
  "prices.col_service": "Tilaus",
  "prices.col_from": "Hinta alussa",
  "prices.col_to": "Hinta nyt",
  "prices.col_change": "Muutos",
} as const;
