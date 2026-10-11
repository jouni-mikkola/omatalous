/** Finnish wording of Asetukset > Ylläpito in one place, so it is read through once. */
export const ENABLE_DOC = "https://github.com/jouni-mikkola/omatalous/blob/main/docs/ADVANCED.md#the-maintenance-helper";
export const ROLLBACK_HELP = "./scripts/update.sh --rollback";

export const S = {
  title: "Ylläpito",
  intro: "Päivitys, varmuuskopio ja tarkistukset selaimesta. Pyynnöt ajaa koneelle asennettu apuri.",
  helperOk: (time: string) => `Apuri toimii (nähty ${time})`,
  helperSlow: (time: string) => `Apuri ei ole vastannut hetkeen (nähty ${time}). Pyynnöt jäävät jonoon ja vanhenevat 10 minuutissa.`,
  helperNever: "Ylläpitoapuri ei ole käytössä",
  helperNeverHelp: "Ota se käyttöön koneella tällä komennolla. Komento on turvallista ajaa uudelleen.",
  helperStale: "Apuri ei ole vastannut yli vuorokauteen. Kone voi olla sammuksissa tai ajastin pysähtynyt. Tarkista ajastin koneella:",
  helperOutdated: "Apuri on vanhentunut. Aja koneella:",
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
  rollbackBody: "Sovellus palaa edelliseen versioon. Jos se ei osaa lukea päivitettyä tietokantaa, käyttöön otetaan päivitystä edeltänyt kopio, ja sen jälkeen tallennetut tiedot katoavat. Nykytilasta otetaan ensin kopio.",
  rollbackSchema: "Päivitys muutti tietokannan rakennetta.",
  rollbackConfirm: (word: string) => `Kirjoita ${word} vahvistukseksi`,
  password: "Salasanasi",
  cancel: "Peruuta",
  working: "Hetki…",
  queued: "Jonossa. Apuri ottaa pyynnön vastaan minuutin kuluessa.",
  running: "Käynnissä.",
  restarting: "Sovellus käynnistyy uudelleen…",
  restartingLong: `Jos sivu ei palaa, aja koneella: ${ROLLBACK_HELP}`,
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
  toolsIntro: "Lokit, levytila ja apurin asennus.",
  logs: "Lue lokit",
  logsHelp: "Sovelluksen ja sen palvelujen (Caddy, tunneli) viimeiset 100 riviä. Avaimet ja tunnisteet piilotetaan.",
  prune: "Siivoa levy",
  pruneHelp: "Poistaa vanhat versiot ja välimuistin. Käytössä oleva ja edellinen versio jäävät.",
  renew: "Asenna apuri uudelleen",
  renewHelp: "Asentaa apurin ajastuksen ja asetukset uudelleen tästä kansiosta. Tämä tapahtuu myös jokaisen päivityksen jälkeen.",
  toolsOutdated: "Apuri on vanhentunut, eikä se osaa näitä toimintoja. Aja koneella:",
  helperOffButtons: "Painikkeet ovat pois käytöstä, kunnes apuri on käytössä.",
};

export const LEVEL: Record<string, string> = { ok: "kunnossa", warn: "varoitus", error: "virhe" };
export const KIND: Record<string, string> = { daily: "päivittäinen", "pre-update": "ennen päivitystä", manual: "käsin" };

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} t`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kt`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mt`;
}
