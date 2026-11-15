/**
 * The maintenance helper's shell scripts say their summaries and steps in Finnish (the DB keeps what they said, so the
 * Finnish stays as it is). A member who reads English gets each sentence from this table: `{1}` is a part the script
 * fills in, and the same `{1}` stands in the English line. A part that is a sentence of its own is translated too. What
 * the table does not know stays Finnish, never guessed. `test/ops-english.test.ts` reads the scripts and fails for a
 * sentence with no line here.
 * Decision: an admin who reads English decides whether the update worked and what to do next.
 */
import type { Language } from "@banking/core";

const LINES: readonly (readonly [string, string])[] = [
  // the app's own words about a request
  ["Apuri ei ottanut pyyntöä vastaan.", "The helper did not take the request."],
  ["Ei vastausta.", "No answer."],
  ["Pyyntö oli jo käsitelty.", "The request was handled already."],
  ["Virheellinen pyyntö.", "Invalid request."],
  ["Apuri ei tue tätä toimintoa.", "The helper does not support this action."],
  ["Virheellinen yhteenveto.", "Invalid summary."],
  ["Valmis.", "Done."],
  ["Epäonnistui.", "Failed."],
  ["Tuntematon toiminto.", "Unknown action."],
  // the helper
  ["Uusi versio on saatavilla.", "A new version is available."],
  ["Uusin versio on käytössä.", "The latest version is in use."],
  ["Uusin versio on jo käytössä.", "The latest version is already in use."],
  ["Uutta versiota ei voitu tarkistaa.", "The new version could not be checked."],
  ["Uutta versiota ei voitu tarkistaa. Mikään ei muuttunut.", "The new version could not be checked. Nothing changed."],
  ["Julkaisun {1} koodia ei saatu.", "The code of release {1} could not be fetched."],
  ["Uutta versiota ei saatu ladattua. Mikään ei muuttunut.", "The new version could not be downloaded. Nothing changed."],
  ["Version {1} koodia ei löytynyt.", "The code of version {1} was not found."],
  ["Uusi versio ei jatka asennettua versiota. Mikään ei muuttunut.", "The new version does not continue the installed one. Nothing changed."],
  ["Version koodi ei ole päivityslähteessä. Mikään ei muuttunut.", "The code of the version is not in the update source. Nothing changed."],
  ["Yksityisen kehitysversion uusinta versiota ei löytynyt.", "The newest version of the private development branch was not found."],
  ["Lähdekoodin uusinta versiota ei löytynyt.", "The newest version of the source code was not found."],
  ["Uusimman version tarkistukset GitHubissa eivät ole vielä menneet läpi. Mikään ei muuttunut.", "The checks of the newest version have not passed on GitHub yet. Nothing changed."],
  ["Uusimman version tarkistuksia ei voitu kysyä GitHubista. Mikään ei muuttunut.", "GitHub could not be asked for the checks of the newest version. Nothing changed."],
  ["Uutta koodia ei ole allekirjoittanut luotettu avain. Mikään ei muuttunut.", "The new code is not signed by a trusted key. Nothing changed."],
  ["Uuden version asetukset eivät täytä turvasääntöjä ({1}). Mikään ei muuttunut.", "The settings of the new version do not meet the safety rules ({1}). Nothing changed."],
  ["Päivitetty: {1} → {2}.", "Updated: {1} → {2}."],
  ["Päivitetty sovellus ei vastaa.", "The updated app does not respond."],
  ["{1} Palautus epäonnistui, katso ops/RECOVERY.txt.", "{1} The restore failed, see ops/RECOVERY.txt."],
  ["{1} Edellistä versiota ei voitu palauttaa, käynnissä on versio {2}.", "{1} The previous version could not be restored, version {2} is running."],
  ["{1} Edellinen versio palautettiin.", "{1} The previous version was restored."],
  ["Uuden version tietokantamuutokset epäonnistuivat kopiolla. Edellinen versio on käynnissä ja tiedot ovat ennallaan. Syy on lokissa.", "The database changes of the new version failed on a copy. The previous version is running and the data is unchanged. The reason is in the log."],
  ["Tietokantamuutosten tarkistusta ei voitu ajaa. Edellinen versio on käynnissä ja tiedot ovat ennallaan. Syy on lokissa.", "The check of the database changes could not run. The previous version is running and the data is unchanged. The reason is in the log."],
  ["Päivitys ei onnistunut, edellinen versio on käynnissä. Syy on lokissa.", "The update failed, the previous version is running. The reason is in the log."],
  ["Päivitys ei onnistunut. Syy on lokissa.", "The update failed. The reason is in the log."],
  ["Päivitetty: {1} → {2}, mutta uusi ylläpitoapuri ei toimi ({3}). Päivitystä ei palautettu, koska tuoretta varmuuskopiota ei ole.", "Updated: {1} → {2}, but the new maintenance helper does not work ({3}). The update was not taken back because there is no fresh backup."],
  ["Edellinen versio palautettiin, koska uusi ylläpitoapuri ei toiminut ({1}).", "The previous version was restored because the new maintenance helper did not work ({1})."],
  ["Uusi ylläpitoapuri ei toiminut ({1}). Palautus epäonnistui, katso ops/RECOVERY.txt.", "The new maintenance helper did not work ({1}). The restore failed, see ops/RECOVERY.txt."],
  ["Edellinen versio palautettu: {1}.", "The previous version is restored: {1}."],
  ["Palautettu sovellus ei vastaa.", "The restored app does not respond."],
  ["Palautus ei onnistunut. Syy on lokissa.", "The restore failed. The reason is in the log."],
  ["Levytila ei riitä ({1} Mt vapaana, {2})", "Not enough disk space ({1} MB free, {2})"],
  ["Ylläpitoapurin asetukset puuttuvat (aja ./scripts/install.sh --ops-helper)", "The maintenance helper's settings are missing (run ./scripts/install.sh --ops-helper)"],
  ["Päivityslähde on muuttunut", "The update source has changed"],
  ["Päivityslähteen osoite ei ole sallittu", "The address of the update source is not allowed"],
  ["Päivityslähteen versiolinja on muuttunut", "The branch of the update source has changed"],
  ["Asennuskansion tiedostoja on muutettu käsin", "Files of the install folder were changed by hand"],
  ["jq puuttuu", "jq is missing"],
  ["versiota ei löydy", "the version was not found"],
  ["ylimääräinen asetustiedosto", "an extra settings file"],
  ["väliaikaiskansio puuttuu", "the temporary folder is missing"],
  ["docker-compose.yml puuttuu", "docker-compose.yml is missing"],
  ["asetustiedostoa ei voi lukea", "the settings file cannot be read"],
  // the self-test
  ["apurin tiedostossa on virhe", "a helper file has an error"],
  ["apurin tiedostot eivät kelpaa", "the helper files are not valid"],
  ["apurin tiedostojen oikeudet eivät kelpaa", "the permissions of the helper files are not valid"],
  [".env ei kelpaa", ".env is not valid"],
  ["koneelta puuttuu ohjelma", "a program is missing from the machine"],
  ["Docker ei vastaa", "Docker does not respond"],
  ["sovellus ei vastaa apurille", "the app does not respond to the helper"],
  ["sovellus ei kerro versiotaan", "the app does not tell its version"],
  ["sovellus ei vastaa apurin kyselyyn", "the app does not answer the helper's poll"],
  ["itsetesti ei valmistunut ajoissa", "the self-test did not finish in time"],
  ["itsetesti epäonnistui", "the self-test failed"],
  // restart, check, logs, prune, renew
  ["Uudelleenkäynnistys ei onnistunut.", "The restart failed."],
  ["Sovellus käynnistyi uudelleen.", "The app restarted."],
  ["Sovellus ei vastaa uudelleenkäynnistyksen jälkeen.", "The app does not respond after the restart."],
  ["Tarkistus: {1} ongelmaa, {2} varoitusta.", "Check: {1} problems, {2} warnings."],
  ["Tarkistus: ei ongelmia, {1} varoitusta.", "Check: no problems, {1} warnings."],
  ["Tarkistus: kaikki kunnossa.", "Check: all well."],
  ["Tarkistus ei onnistunut.", "The check failed."],
  ["Lokien luku ei onnistunut (palvelu {1}).", "Reading the logs failed (service {1})."],
  ["Luettu: {1}.", "Read: {1}."],
  ["Kuvien siivous ei onnistunut. Syy on lokissa.", "Cleaning the images failed. The reason is in the log."],
  ["Välimuistin siivous ei onnistunut. Syy on lokissa.", "Cleaning the cache failed. The reason is in the log."],
  ["Siivous poisti version, jonka piti jäädä.", "The cleanup removed a version that was meant to stay."],
  ["Siivous poisti käynnissä olevan version kuvan.", "The cleanup removed the image of the running version."],
  ["Ei vapautettavaa.", "Nothing to free."],
  ["Levyltä vapautui {1} vanhoista versioista ja {2} välimuistista.", "Freed {1} from old versions and {2} from the cache."],
  ["Levyltä vapautui {1} vanhoista versioista.", "Freed {1} from old versions."],
  ["Apuri asennettu uudelleen.", "Helper reinstalled."],
  ["Apurin uusinta ei onnistunut. Syy on lokissa.", "Renewing the helper failed. The reason is in the log."],
  ["{1} Käynnistimme sovelluksen, ja se vastaa.", "{1} The app was started, and it responds."],
  ["{1} Käynnistimme sovelluksen, mutta se ei vastaa.", "{1} The app was started, but it does not respond."],
  ["Asennuksen .env-tiedostoa ei ole. Mitään ei muutettu.", "The install has no .env file. Nothing was changed."],
  ["Käyttäjätunnus ei ole kelvollinen. Mitään ei lähetetty.", "The user name is not valid. Nothing was sent."],
  ["Kansio ei ole kelvollinen. Mitään ei lähetetty.", "The folder is not valid. Nothing was sent."],
  ["Salausavain ei ole kelvollinen. Mitään ei lähetetty.", "The encryption key is not valid. Nothing was sent."],
  ["SSH-avain ei ole kelvollinen. Mitään ei lähetetty.", "The SSH key is not valid. Nothing was sent."],
  // the setting of new versions
  ["Tiedosto .env ei ole kelvollinen. Mitään ei muutettu.", "The .env file is not valid. Nothing was changed."],
  ["Tämä asennus päivittyy yksityisestä kehitysversiosta eikä julkaistuista versioista. Mitään ei muutettu.", "This install updates from the private development branch, not from released versions. Nothing was changed."],
  ["Tämä asennus päivittyy lähdekoodista eikä julkaistuista versioista. Mitään ei muutettu.", "This install updates from the source code, not from released versions. Nothing was changed."],
  ["Palvelimella on asennus tai päivitys kesken. Mitään ei muutettu.", "An install or update is in progress on the server. Nothing was changed."],
  ["Tiedostoa .env ei voitu kirjoittaa. Mitään ei muutettu.", "The .env file could not be written. Nothing was changed."],
  ["Kirjoitimme asetuksen tiedostoon .env, mutta apuri ei saa sitä sieltä luettua. Tarkista tiedosto palvelimella.", "The setting was written to the .env file, but the helper cannot read it back. Check the file on the server."],
  ["Tarjoamme uudet versiot heti.", "New versions are offered at once."],
  ["Tarjoamme uudet versiot kaksi päivää julkaisun jälkeen.", "New versions are offered two days after release."],
  ["{1} Uusi versio on saatavilla.", "{1} A new version is available."],
  ["{1} Uutta versiota ei voitu tarkistaa.", "{1} The new version could not be checked."],
  // the steps
  ["Tarkistetaan uusi versio", "Checking the new version"],
  ["Tarkistetaan", "Checking"],
  ["Haetaan ja vaihdetaan versio", "Fetching and switching the version"],
  ["Tarkistetaan että sovellus vastaa", "Checking that the app responds"],
  ["Valmis", "Done"],
  ["Palautetaan edellinen versio", "Restoring the previous version"],
  ["Luetaan valmisteltu muutos", "Reading the prepared change"],
  ["Kirjoitetaan asetukset ja käynnistetään sovellus", "Writing the settings and starting the app"],
  ["Odotetaan että sovellus vastaa", "Waiting for the app to respond"],
  ["Käynnistetään sovellus uudelleen", "Restarting the app"],
  ["Tarkistetaan asennus", "Checking the install"],
  ["Luetaan palvelujen lokit", "Reading the service logs"],
  ["Poistetaan vanhat versiot", "Removing old versions"],
  ["Tyhjennetään välimuisti", "Clearing the cache"],
  ["Asennetaan apuri uudelleen tästä kansiosta", "Reinstalling the helper from this folder"],
  ["Tarkistetaan tulos", "Checking the result"],
  ["Tallennetaan asetus", "Saving the setting"],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Each line as a pattern: a `{n}` part is any text, and the English line puts the n-th part where `{n}` stands. */
// longest line first, so a short pattern with a `{n}` never takes a sentence a longer line is made for
const COMPILED = [...LINES].sort((a, b) => b[0].length - a[0].length).map(([fi, en]) => {
  const order: number[] = [];
  const source = escapeRe(fi).replace(/\\\{(\d)\\\}/g, (_m, n: string) => {
    order.push(Number(n));
    return "(.+?)";
  });
  return { re: new RegExp(`^${source}$`, "s"), order, en };
});

/** The English of a helper sentence, or the text itself when no line knows it. */
function opsEnglish(text: string): string {
  for (const { re, order, en } of COMPILED) {
    const hit = re.exec(text);
    if (!hit) continue;
    const parts = new Map(order.map((n, i) => [n, opsEnglish(hit[i + 1]!)] as const));
    return en.replace(/\{(\d)\}/g, (_m, n: string) => parts.get(Number(n)) ?? "");
  }
  return text;
}

/** A line of the helper in the member's language. */
export const opsText = (text: string, language: Language): string => (language === "en" ? opsEnglish(text) : text);

/** The names of the actions in English; the Finnish ones are ACTION_LABEL in ops.ts (the audit list keeps those). */
export const ACTION_LABEL_EN = {
  update: "update",
  rollback: "restore of the previous version",
  restart: "restart",
  doctor: "system check",
  "check-update": "check for updates",
  logs: "reading the logs",
  prune: "disk cleanup",
  "helper-renew": "helper renewal",
  "prerelease-on": "new versions offered at once",
  "prerelease-off": "new versions offered after two days",
} as const;
