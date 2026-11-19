/**
 * The refusals the server still throws as a Finnish sentence (a catalogue code is better, and a new refusal should
 * have one). A member who reads English gets the sentence from this table when the answer is made (`sentenceFor`, the
 * 404 of `app.ts`). `{1}` is a part the code fills in, and the same `{1}` stands in the English line. A sentence the
 * table does not know stays Finnish. `test/refusals-en.test.ts` reads the sources and fails for a literal with no
 * line here, so Finnish bytes at the throw sites stay as they were.
 * Decision: a member who reads English knows what to correct when the app refuses an input.
 */
import type { Language } from "@banking/core";

const LINES: readonly (readonly [string, string])[] = [
  // accounts and use
  ["Valitse tilille ainakin yksi käyttäjä.", "Choose at least one user for the account."],
  ["Tilillä voi olla enintään kahdeksan käyttäjää.", "An account can have at most eight users."],
  ["Virheellinen osuus.", "Invalid share."],
  ["Sama käyttäjä on valittu kahdesti.", "The same user is chosen twice."],
  ["Ainakin yhdellä käyttäjällä pitää olla osuus.", "At least one user must have a share."],
  ["Tiliä ei löydy.", "The account was not found."],
  ["Saldon voi asettaa vain tuodulle tilille.", "A balance can be set only on an imported account."],
  ["Pankkiyhteyden tiliä ei voi poistaa.", "An account of a bank connection cannot be deleted."],
  ["Tiliä ei voi jakaa.", "The account cannot be shared."],
  ["Virheellinen maksaja.", "Invalid payer."],
  ["Virheellinen vastaus.", "Invalid answer."],
  ["Maksajaa ei löydy.", "The payer was not found."],
  ["Ei yhteyksiä, jotka pitäisi uusia.", "No connections need renewing."],
  ["Yhteyttä ei löydy.", "The connection was not found."],
  // the data reset
  ["Pankki ei vastannut, yhteyttä ei poistettu. Yritä uudelleen.", "The bank did not answer, so the connection was not removed. Try again."],
  ["Omaa pankkiavainta ei voi avata. Tallenna se uudelleen kohdassa Asetukset > Pankit ja tilit.", "Your own bank key cannot be opened. Save it again in Settings > Banks and accounts."],
  ["Pankkiyhteys on käytössä ({1}), joten sovellusta ei voi {2}. Poista yhteydet ensin kohdassa Asetukset > Pankit ja tilit.", "A bank connection is in use ({1}), so the app cannot {2}. Remove the connections first in Settings > Banks and accounts."],
  ["Istunto on päättynyt. Kirjaudu sisään uudelleen.", "The session has ended. Sign in again."],
  ["Tunnuksesi ei ole enää ylläpitäjä, joten emme tyhjentäneet mitään.", "Your account is no longer an administrator, so nothing was emptied."],
  ["Tietokannasta ei saa tässä asennuksessa varmuuskopiota, joten emme tyhjentäneet mitään.", "This install cannot back up the database, so nothing was emptied."],
  ["Tietojen haku on kesken. Yritä hetken päästä uudelleen.", "Data is being fetched. Try again in a moment."],
  ["Samalla hetkellä tehty varmuuskopio on jo olemassa. Yritä hetken päästä uudelleen.", "A backup made at the same moment already exists. Try again in a moment."],
  ["Varmuuskopion teko epäonnistui, joten emme tyhjentäneet mitään.", "The backup failed, so nothing was emptied."],
  ["Tietojen tyhjennys epäonnistui, ja tietosi ovat ennallaan. Ehdimme lopettaa pankkiyhteydet: yhdistä pankki uudelleen.", "Emptying the data failed, and the data is unchanged. The bank connections were already ended: connect the bank again."],
  ["Tietojen tyhjennys epäonnistui, ja tietosi ovat ennallaan.", "Emptying the data failed, and the data is unchanged."],
  ["Pankkihaku tai muu taustatyö on kesken. Yritä hetken päästä uudelleen.", "A bank fetch or other background work is running. Try again in a moment."],
  // maintenance
  ["Salasana ei täsmää.", "The password does not match."],
  ["Ylläpitoapuri ei ole käytössä.", "The maintenance helper is not on."],
  ["Ylläpitoapurista on uudempi versio. Päivitä se palvelimella: {1}", "A newer version of the maintenance helper exists. Update it on the server: {1}"],
  ["Käynnistä kopio toiselle koneelle kohdassa Asetukset > Palvelin ja ylläpito.", "The copy to another machine is started under Settings > Server and maintenance."],
  ["Edellistä versiota ei ole tallessa.", "The previous version is not kept."],
  ["Pyyntöä ei löydy.", "The request was not found."],
  ["Pyyntöä ei voi enää perua.", "The request can no longer be cancelled."],
  ["Virheellinen pyynnön tunnus.", "Invalid request ID."],
  ["Virheellinen tila.", "Invalid status."],
  ["Virheellinen poistumiskoodi.", "Invalid exit code."],
  ["Virheellinen yhteenveto.", "Invalid summary."],
  ["Virheellinen loki.", "Invalid log."],
  ["Virheellinen vaihe.", "Invalid step."],
  ["Valitse toiminto.", "Choose an action."],
  ["Tätä toimintoa ei voi vielä tehdä selaimessa.", "This action cannot be done in the browser yet."],
  ["Tuntematon toiminto.", "Unknown action."],
  ["Toiminnolle ei anneta valintoja.", "The action takes no options."],
  ["Virheellinen kenttä.", "Invalid field."],
  ["Toinen toiminto on kesken.", "Another action is running."],
  ["Kirjoita {1} vahvistukseksi.", "Type {1} to confirm."],
  ["Syöte on liian pitkä.", "The input is too long."],
  ["Syöte ei ole kelvollista JSONia.", "The input is not valid JSON."],
  ["Palvelimen salausavain puuttuu. Ylläpitäjä löytää syyn palvelimen lokista.", "The server's encryption key is missing. The admin finds the cause in the server log."],
  ["Palvelimen salausavain on vaihdettu. Käynnistä sovellus uudelleen ja yritä sitten uudelleen.", "The server's encryption key was changed. Restart the app and try again."],
  ["Levy on täynnä, eikä tietoja voitu tallentaa. Pyydä ylläpitäjää vapauttamaan tilaa.", "The disk is full, so the data could not be saved. Ask an administrator to free some space."],
  ["Tietokanta on varattu. Yritä hetken päästä uudelleen.", "The database is busy. Try again in a moment."],
  ["Palvelutunnusta ei löydy.", "The service token was not found."],
  ["Varmennetta ei ole. Luo avain ensin.", "There is no certificate. Create the key first."],
  ["Istuntoa ei löydy.", "The session was not found."],
  ["Tuntematon merkinnän tyyppi.", "Unknown entry type."],
  ["Tuntematon rooli.", "Unknown role."],
  ["Tuntematon paluutapa.", "Unknown return method."],
  // shared bills and agreements
  ["Virheellinen kuukausi.", "Invalid month."],
  ["Virheellinen päivä.", "Invalid day."],
  ["Sopimusta ei löydy.", "The agreement was not found."],
  ["Sopimusta ei voi poistaa.", "The agreement cannot be deleted."],
  ["Virheellinen sopimus.", "Invalid agreement."],
  ["Valitse tilin käyttäjät.", "Choose the users of the account."],
  ["Kerro, miten jaat kiinteän summan jälkeen jäävän osan.", "Say how the part left after the fixed sum is split."],
  ["Kortille ei voi sopia kiinteää määrää.", "A fixed amount cannot be agreed for a card."],
  ["Tälle päivälle on jo sopimus.", "There is already an agreement for this day."],
  ["Virheellinen jäsenlista.", "Invalid member list."],
  ["Virheellinen nimi.", "Invalid name."],
  ["Sama nimi on kahdesti.", "The same name appears twice."],
  ["Jäsentä ei löydy.", "The member was not found."],
  ["Sama jäsen on kahdesti.", "The same member appears twice."],
  ["Valitse yksi tilin käyttäjistä.", "Choose one of the users of the account."],
  // transactions, rules, merchants, categories
  ["Virheellinen kohde.", "Invalid subject."],
  ["Virheellinen merkintä.", "Invalid mark."],
  ["Merkintöjä on liikaa.", "There are too many marks."],
  ["Virheellinen pyyntö.", "Invalid request."],
  ["Virheellinen pyyntö. Lataa sivu uudelleen.", "Invalid request. Reload the page."],
  ["Tapahtumaa ei löydy.", "The transaction was not found."],
  ["Kauppiasta ei löydy.", "The merchant was not found."],
  ["Tuntemattomalle kauppiaalle ei voi asettaa kategoriaa. Vaihda kategoria tapahtumalta.", "An unknown merchant cannot be given a category. Change the category on the transaction."],
  ["Sääntöjä voi olla enintään {1}.", "There can be at most {1} rules."],
  ["Virheellinen sääntö.", "Invalid rule."],
  ["Valitse kategoria.", "Choose a category."],
  ["Tuntematon kategoria.", "Unknown category."],
  ["Tuntematon tilityyppi.", "Unknown account type."],
  ["Virheellinen saldo.", "Invalid balance."],
  ["Virheellinen jako.", "Invalid split."],
  ["Virheellinen kauppiaan nimi.", "Invalid merchant name."],
  ["Virheellinen rajaus.", "Invalid filter."],
  ["Kysymystä ei löydy.", "The question was not found."],
  ["Tuntematon raportti.", "Unknown report."],
  ["Lainaa ei löydy.", "The loan was not found."],
  ["Laskua ei löydy.", "The bill was not found."],
  ["Erittelyä ei löydy.", "The statement was not found."],
  ["Virheellinen jakso.", "Invalid period."],
  ["Virheellinen summa.", "Invalid amount."],
  ["Rivejä ei ole.", "There are no rows."],
  ["Virheellinen rivi.", "Invalid row."],
  ["Ei löydy.", "Not found."],
  ["Logoa ei löydy.", "The logo was not found."],
  ["Liitä koko osoite selaimen osoiteriviltä.", "Paste the whole address from the browser's address bar."],
  ["Osoite on vajaa. Liitä koko osoite.", "The address is incomplete. Paste the whole address."],
  // loans, bills, goals
  ["Tuntematon laji.", "Unknown kind."],
  ["Viimeisen erän osien pitää olla yhteensä vähintään 0,01 € ja enintään {1}.", "The parts of the last payment must add up to at least 0.01 € and at most {1}."],
  ["Viimeisen erän päivä voi olla enintään {1} vuotta sitten, eikä se voi olla tulevaisuudessa.", "The date of the last payment can be at most {1} years ago and cannot be in the future."],
  ["Viimeisen erän lyhennyksen pitää olla vähintään 0 € ja enintään {1}.", "The principal of the last payment must be at least 0 € and at most {1}."],
  ["Viimeisen erän koron pitää olla vähintään 0 € ja enintään {1}.", "The interest of the last payment must be at least 0 € and at most {1}."],
  ["Viimeisen erän luottokulujen pitää olla vähintään 0 € ja enintään {1}.", "The credit costs of the last payment must be at least 0 € and at most {1}."],
  ["Erän kulun pitää olla vähintään 0 € ja enintään {1}.", "The fee of each payment must be at least 0 € and at most {1}."],
  ["Tuntematon viitekorko.", "Unknown reference rate."],
  ["Tuntematon tapa, jolla erä muuttuu.", "Unknown way the payment changes."],
  ["Anna lainalle nimi, 1–{1} merkkiä.", "Give the loan a name of 1–{1} characters."],
  ["Lainanantajan nimi voi olla enintään {1} merkkiä.", "The lender's name can be at most {1} characters."],
  ["Virheellinen maksusarja.", "Invalid payment series."],
  ["Lainan voi liittää vain omaan luottokortti- tai lainatiliin.", "A loan can be linked only to your own credit card or loan account."],
  ["Tähän tiliin on jo liitetty laina {1}. Poista liitos siitä ensin.", "The loan {1} is already linked to this account. Remove the link from it first."],
  ["Luottokortilla ja joustoluotolla ei ole kohtaa Miten erä muuttuu. Jätä se tyhjäksi.", "A credit card and a credit line have no setting for how the payment changes. Leave it empty."],
  ["Kertalyhenteisellä lainalla ei ole kuukausierää. Jätä kuukausierä tyhjäksi.", "A bullet loan has no monthly payment. Leave the monthly payment empty."],
  ["Kuukausierä on pienempi kuin lyhennysvälin korko, joten laina ei lyhenisi. Tarkista luvut tai jätä kuukausierä tyhjäksi, jos maksat vain korkoa.", "The monthly payment is smaller than the interest of the repayment interval, so the loan would not shrink. Check the figures, or leave the monthly payment empty if you pay only interest."],
  ["Koron muutoksesta pitää antaa sekä päivä että uusi korko. Täytä molemmat tai jätä molemmat tyhjiksi.", "Give both the day and the new rate of a rate change. Fill in both or leave both empty."],
  ["Koron muutokselle pitää antaa myös korko ennen muutosta.", "Give the rate before the change too for a rate change."],
  ["Kuukausierä on pienempi kuin koron muutoksen jälkeinen lyhennysvälin korko, joten laina ei lyhenisi muutoksen jälkeen. Tarkista luvut tai jätä kuukausierä tyhjäksi, jos maksat vain korkoa.", "The monthly payment is smaller than the interest of the repayment interval after the rate change, so the loan would not shrink after it. Check the figures, or leave the monthly payment empty if you pay only interest."],
  ["Lainoja voi olla enintään {1}. Poista ensin turhat.", "There can be at most {1} loans. Delete the unneeded ones first."],
  ["Tavoitteen pitää olla vähintään 1 € ja enintään 1 000 000 € kuussa.", "The goal must be at least €1 and at most €1,000,000 a month."],
  ["Aseta tavoite vain ruoalle, ravintoloille ja liikenteelle.", "A goal can be set only for food, restaurants and transport."],
  ["Anna laskulle nimi, 1–{1} merkkiä.", "Give the bill a name of 1–{1} characters."],
  ["Summan pitää olla vähintään 0,01 € ja enintään 1 000 000 €.", "The amount must be at least €0.01 and at most €1,000,000."],
  ["Eräpäivä voi olla enintään {1} päivää sitten ja {2} päivän päässä.", "The due date can be at most {1} days ago and {2} days ahead."],
  ["Tuntematon toistuvuus.", "Unknown cadence."],
  ["Valitse meno- tai velkakategoria.", "Choose an expense or debt category."],
  ["Itse lisättyjä laskuja voi olla enintään {1}. Poista ensin turhat.", "There can be at most {1} bills you added yourself. Delete the unneeded ones first."],
  // Optimoi
  ["Vinkkiä ei löydy.", "The finding was not found."],
  ["Tuntematon tieto.", "Unknown input."],
  ["Vakuutusta ei löydy tiedoistasi.", "The insurance was not found in your data."],
  ["Tietoja voi olla enintään {1}. Poista ensin turhat.", "There can be at most {1} inputs. Delete the unneeded ones first."],
  ["Päätöksiä on liikaa. Poista ensin vanhoja.", "There are too many decisions. Delete old ones first."],
  ["Virheellinen vinkin tunniste.", "Invalid finding ID."],
  ["Valitse tila: tehty, ohitettu tai lykätty.", "Choose a status: done, skipped or postponed."],
  ["Kenttä ei kuulu tähän valintaan.", "The field does not belong to this choice."],
  ["Valitse syy listasta.", "Choose a reason from the list."],
  ["Anna päivä, joka on aikaisintaan huomenna ja enintään vuoden päässä.", "Give a day that is tomorrow at the earliest and at most a year ahead."],
  ["Anna päivä, joka on enintään vuoden päässä.", "Give a day that is at most a year away."],
  // second factor and security
  ["Kaksivaiheista kirjautumista ei voi käyttää, koska palvelimella ei ole salausavainta.", "Two-step sign-in cannot be used because the server has no encryption key."],
  ["Palvelimen salausavain on vaihdettu. Käynnistä sovellus uudelleen ja aloita käyttöönotto sen jälkeen.", "The server's encryption key was changed. Restart the app and start the setup after that."],
  ["Kaksivaiheinen kirjautuminen on jo käytössä.", "Two-step sign-in is already on."],
  ["Aloita kaksivaiheisen kirjautumisen käyttöönotto alusta.", "Start the two-step sign-in setup again from the beginning."],
  ["Kaksivaiheinen kirjautuminen ei ole käytössä.", "Two-step sign-in is not on."],
  ["Ylläpitäjä voi poistaa kaksivaiheisen kirjautumisensa vain itse.", "An administrator can remove their own two-step sign-in only themselves."],
  ["Jäsenellä ei ole kaksivaiheista kirjautumista.", "The member has no two-step sign-in."],
  // import
  ["Tuonti on päättynyt tai vanhentunut. Aloita alusta.", "The import has ended or expired. Start again."],
  ["Tiedosto ei ole Omatalouden tietotiedosto.", "The file is not an Omatalous data file."],
  ["Emme voi tuoda tämän version tiedostoa. Tämä Omatalous lukee tiedoston version {1}.", "The version of the file cannot be imported. This Omatalous reads file version {1}."],
  ["Tiedosto on toisen käyttäjän. Tuo vain omat tietosi.", "The file belongs to another user. Import only your own data."],
  ["Tuonteja on käynnissä liian monta. Yritä hetken päästä uudelleen.", "Too many imports are running. Try again in a moment."],
  ["{1} Mitään ei tuotu.", "{1} Nothing was imported."],
  // banks
  ["Avaa Omatalous kotiverkon osoitteesta, esimerkiksi http://192.168.1.10:8080, tai ota käyttöön oma https-osoite. Tallenna osoite kohdassa Asetukset > Palvelin ja ylläpito. Englanninkielinen ohje on tiedostossa docs/ADVANCED.md, kohdassa A https name for the home network.", "Open Omatalous from your home network address, for example http://192.168.1.10:8080, or set up your own https address. The address is saved under Settings > Server and maintenance. The guide is in docs/ADVANCED.md, under A https name for the home network."],
  ["Pankkiavainta ei voi avata. Pyydä ylläpitäjää katsomaan palvelimen lokia.", "The bank key cannot be opened. Ask an administrator to look at the server log."],
  ["Avaimia ei voi nyt tallentaa. Pyydä ylläpitäjää katsomaan palvelimen lokia.", "The keys cannot be saved now. Ask an administrator to look at the server log."],
  ["{1} Avainta ei tallennettu.", "{1} The key was not saved."],
  ["Pankkiyhteydet eivät ole vielä käytössä. Pyydä ylläpitäjää ottamaan ne käyttöön kohdassa Asetukset > Pankit ja tilit.", "Bank connections are not on yet. Ask an administrator to turn them on under Settings > Banks and accounts."],
  ["Application ID on muotoa 12345678-abcd-… (Control Panel > API applications).", "The application ID looks like 12345678-abcd-… (Control Panel > API applications)."],
  ["Luo ensin avain tai valitse Enable Bankingin lataama .pem-tiedosto.", "Create a key first, or choose the .pem file Enable Banking downloaded."],
  ["Liian monta testiä peräkkäin. Odota muutama minuutti.", "Too many tests in a row. Wait a few minutes."],
  ["Tuntematon pankki.", "Unknown bank."],
  ["Pankkia {1} ({2}) ei löytynyt Enable Bankingista.", "The bank {1} ({2}) was not found in Enable Banking."],
  ["Enable Banking ei hyväksy paluuosoitetta. Lisää sovelluksen Redirect URLs -kohtaan: {1}", "Enable Banking does not accept the return address. Add it to the application's Redirect URLs: {1}"],
  // limits
  // the import of a data file
  ["Tiedoston osa puuttuu tai on väärässä järjestyksessä.", "A part of the file is missing or out of order."],
  ["Tiedosto on liian suuri tuotavaksi.", "The file is too large to import."],
  ["Tiedoston osa on väärän muotoinen.", "A part of the file has the wrong shape."],
  ["Tiedoston kohta {1} on väärän muotoinen.", "Section {1} of the file has the wrong shape."],
  ["Tiedoston kohdassa {1} on liikaa rivejä.", "Section {1} of the file has too many rows."],
  ["Tiedoston kohdan {1} rivi {2} on virheellinen ({3}).", "Row {2} of section {1} of the file is invalid ({3})."],
  ["Tiedoston kohdan {1} rivi {2} viittaa riviin ({3}), jota tiedostossa tai tässä sovelluksessa ei ole.", "Row {2} of section {1} of the file refers to a row ({3}) that is not in the file or in this app."],
  // the labels of the limits
  ["Kirjautumisyrityksiä osoitteesta", "Sign-in attempts from an address"],
  ["Kirjautumisyrityksiä tunnukselle osoitteesta", "Sign-in attempts for a username from an address"],
  ["Kirjautumisyrityksiä tunnukselle kaikista osoitteista", "Sign-in attempts for a username from all addresses"],
  ["Yritysten jakso (min)", "Period of the attempts (min)"],
  ["Väärää salasanaa salasanan vaihdossa", "Wrong passwords when changing the password"],
  ["Kaksivaiheisen koodin yrityksiä osoitteesta", "Two-step code attempts from an address"],
  ["Kaksivaiheisen koodin yrityksiä kaikista osoitteista", "Two-step code attempts from all addresses"],
  ["Käyttöönoton yrityksiä osoitteesta", "Setup attempts from an address"],
  ["Tuntemattomia palvelutunnuksia osoitteesta", "Unknown service tokens from an address"],
  ["Väärää salasanaa ylläpitopyynnössä", "Wrong passwords in a maintenance request"],
  ["Pankkiavaimen testejä jaksossa", "Bank key tests in a period"],
  ["Avaintestien jakso (min)", "Period of the key tests (min)"],
  ["Pyynnön enimmäiskoko (kt)", "Largest request (kB)"],
  ["Salasanatiivisteitä yhtä aikaa", "Password hashes at a time"],
  ["Salasanatiivisteen muisti (kt)", "Memory of a password hash (kB)"],
  ["Salasanatiivisteen kierrokset", "Passes of a password hash"],
  ["Pankin suostumuksen pituus (pv)", "Length of the bank consent (days)"],
  ["Haettavan historian pituus (pv)", "Length of the history to fetch (days)"],
  ["{1}: anna kokonaisluku {2}–{3}.", "{1}: give a whole number {2}–{3}."],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// longest first, so a short pattern with a `{n}` never takes a sentence a longer line is made for
const COMPILED = [...LINES]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([fi, en]) => {
    const order: number[] = [];
    const source = escapeRe(fi).replace(/\\\{(\d)\\\}/g, (_m, n: string) => {
      order.push(Number(n));
      return "(.+?)";
    });
    return { re: new RegExp(`^${source}$`, "s"), order, en };
  });

/** The English of a refusal sentence (its parts too), or the text itself when no line knows it. */
function refusalEnglish(text: string): string {
  for (const { re, order, en } of COMPILED) {
    const hit = re.exec(text);
    if (!hit) continue;
    const parts = new Map(order.map((n, i) => [n, refusalEnglish(hit[i + 1]!)] as const));
    return en.replace(/\{(\d)\}/g, (_m, n: string) => parts.get(Number(n)) ?? "");
  }
  return text;
}

/** A refusal sentence in the reader's language. */
export const refusalIn = (text: string, language: Language): string => (language === "en" ? refusalEnglish(text) : text);
