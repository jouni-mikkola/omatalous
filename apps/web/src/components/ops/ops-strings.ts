/** Finnish wording of Asetukset > Ylläpito in one place, so it is read through once. */
export const ENABLE_DOC = "https://github.com/jouni-mikkola/omatalous/blob/main/docs/ADVANCED.md#the-maintenance-helper";
export const ROLLBACK_HELP = "./scripts/update.sh --rollback";

export const S = {
  title: "Ylläpito",
  helperOk: (time: string) => `Apuri toimii (nähty ${time})`,
  helperSlow: (time: string) => `Apuri vastasi viimeksi ${time}. Pyynnöt vanhenevat jonossa 10 minuutissa.`,
  helperNever: "Ylläpitoapuri ei ole käytössä",
  helperNeverHelp: "Ota se käyttöön palvelimella:",
  helperStale: "Apuri ei ole vastannut vuorokauteen. Tarkista ajastin palvelimella:",
  helperOutdated: "Apurista on uudempi versio. Päivitä se palvelimella:",
  helperDoc: "Ohje",
  version: "Versio",
  checkUpdates: "Tarkista päivitykset",
  upToDate: (time: string) => `Ajan tasalla (tarkistettu ${time})`,
  notChecked: "Päivityksiä ei ole vielä tarkistettu.",
  updateAvailable: "Uusi versio saatavilla",
  changes: "Muutokset",
  update: "Päivitä",
  updateTitle: "Päivitä sovellus",
  updateBody: ["Tietokannasta otetaan kopio.", "Sovellus käynnistyy hetkeksi uudelleen.", "Edellinen versio voidaan palauttaa."],
  rollback: "Palauta edellinen versio",
  rollbackTitle: "Palauta edellinen versio",
  rollbackBody: "Tietokannasta otetaan ensin kopio. Jos vanha versio ei pysty lukemaan tietokantaa, palautetaan päivitystä edeltävä kopio ja päivityksen jälkeiset muutokset katoavat.",
  rollbackSchema: "Päivitys muutti tietokannan rakennetta.",
  rollbackConfirm: (word: string) => `Kirjoita ${word} vahvistukseksi`,
  password: "Salasanasi",
  cancel: "Peruuta",
  working: "Hetki…",
  queued: "Jonossa. Alkaa minuutin sisällä.",
  running: "Käynnissä.",
  restarting: "Sovellus käynnistyy uudelleen…",
  restartingLong: `Jos sivu ei palaa, palauta edellinen versio palvelimella: ${ROLLBACK_HELP}`,
  cancelRequest: "Peruuta pyyntö",
  ok: "Onnistui",
  failed: "Epäonnistui",
  expired: "Vanhentui",
  cancelled: "Peruttu",
  showLog: "Näytä loki",
  hideLog: "Piilota loki",
  noLog: "Lokia ei ole.",
  backups: "Varmuuskopiot",
  backupNow: "Ota varmuuskopio nyt",
  downloadNewest: "Lataa uusin",
  downloadTitle: "Lataa uusin varmuuskopio",
  downloadBody: "Tiedostossa ovat tapahtumasi ja salatut pankkiavaimet. Salausavain ei ole mukana.",
  keyNote: "Salausavain ei ole mukana kopioissa.",
  noBackups: "Kopioita ei ole vielä.",
  doctor: "Tila",
  runDoctor: "Tarkista järjestelmä",
  noDoctor: "Tarkistusta ei ole vielä ajettu.",
  restart: "Käynnistä sovellus uudelleen",
  restartHelp: "Sovellus on hetken pois käytöstä.",
  events: "Tapahtumaloki",
  noEvents: "Ei merkintöjä.",
  busy: "Toinen toiminto on kesken.",
  tools: "Huolto",
  logs: "Lue lokit",
  logsHelp: "Sovelluksen, Caddyn ja tunnelin 100 viimeistä riviä. Avaimet ja tunnisteet piilotetaan.",
  prune: "Siivoa levy",
  pruneHelp: "Poistaa vanhat versiot ja välimuistin. Nykyinen ja edellinen versio säilyvät.",
  renew: "Asenna apuri uudelleen",
  renewHelp: "Asentaa apurin ajastuksen ja asetukset uudelleen.",
  toolsOutdated: "Apuri ei tue näitä toimintoja. Päivitä se palvelimella:",
  helperOffButtons: "Painikkeet toimivat, kun apuri on käytössä.",
};

export const LEVEL: Record<string, string> = { ok: "kunnossa", warn: "varoitus", error: "virhe" };
export const KIND: Record<string, string> = { daily: "päivittäinen", "pre-update": "ennen päivitystä", manual: "käsin" };

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} t`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kt`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mt`;
}
