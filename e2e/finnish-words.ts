/**
 * The Finnish word list of the English scan (english-scan.spec.ts). A word is Finnish when it has ä, ö or å (no English
 * word of the app does) or is one of these: the words of the app's own texts that an English text never uses. The list is
 * for words without those letters; add a word the scan missed, with the text it came from.
 */
const FINNISH_WORDS = new Set(
  (
    "ja tai ei ovat oli olla ole sinä sinun oma omat tili tilit tilien tilin tilille lasku laskut laskun tapahtuma tapahtumat tapahtumaa tapahtumien " +
    "raportti raportit raportin kuukausi kuukauden kuukautta vuosi vuoden vuotta viikko päivä päivää " +
    "yhteenveto asetukset salasana salasanan käyttäjä käyttäjätunnus kirjaudu kirjautuminen ulos sisään " +
    "tulot menot saldo lainat laina velat kortti kortit tallenna poista peruuta lisää näytä hae uudelleen " +
    "yritä odota lataa sivu sivua palvelin palvelimeen yhteyttä koko talous kaikki tämä mikä kun jos mutta että vain myös " +
    "ilman kanssa kautta koska sekä eli noin vielä jo nyt sitten kaikki jotka joka jokainen " +
    "ladataan kirjaudutaan luodaan nimi koodi koodin asennuskoodi sovellus sovelluksen sovelluksesta " +
    "tarkistettavat avoinna ylläpitäjä jäsen kieli suomi voi voit pitää pitäisi anna valitse"
  ).split(" "),
);

/**
 * Words of the made-up bank's own data (e2e/fake-bank/household.mjs): account names and row texts the bank sends in
 * Finnish, which the app shows as they come. They are not the app's texts. "on" is no entry of the list above, as it is
 * an English word too.
 */
const BANK_DATA = new Set(["säästötili", "käyttötili", "tilin"]);

/** The words of a text, lower case, without the digits and the marks between them. */
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}]+/gu) ?? [];

/** The Finnish words of a text: those with ä, ö or å, and those on the list. */
export function finnishIn(text: string): string[] {
  return [...new Set(wordsOf(text).filter((w) => !BANK_DATA.has(w) && (/[äöå]/.test(w) || FINNISH_WORDS.has(w))))];
}
