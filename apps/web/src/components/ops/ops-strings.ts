import type { HelperInfo, OpsAction, OpsRequestView, OpsSnapshot, RestoreState } from "./types.ts";

/** Finnish wording of Asetukset > Ylläpito in one place, so it is read through once. */
export const ENABLE_DOC = "https://github.com/jouni-mikkola/omatalous/blob/main/docs/ADVANCED.md#the-maintenance-helper";
const ROLLBACK_HELP = "./scripts/update.sh --rollback";
/** Run in the install folder when the app does not come back after a restore request (docker-compose.yml restarts it with `restart: unless-stopped`). */
export const START_HELP = "docker compose up -d";

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
  prerelease: "Tarjoa uudet versiot heti",
  prereleaseHelp: "Uusi versio tulee tavallisesti tarjolle kaksi päivää julkaisunsa jälkeen. Kun tämä on päällä, se tarjotaan heti. Asennus alkaa vasta, kun painat Päivitä.",
  updateTitle: "Päivitä sovellus",
  updateBody: ["Tietokannasta otetaan kopio.", "Sovellus käynnistyy hetkeksi uudelleen.", "Edellinen versio voidaan palauttaa."],
  rollback: "Palauta edellinen versio",
  rollbackTitle: "Palauta edellinen versio",
  rollbackBody: "Tietokannasta otetaan ensin kopio. Jos vanha versio ei pysty lukemaan tietokantaa, palautetaan päivitystä edeltävä kopio ja päivityksen jälkeiset muutokset häviävät.",
  rollbackSchema: "Päivitys muutti tietokannan rakennetta.",
  rollbackConfirm: (word: string) => `Kirjoita ${word} vahvistukseksi`,
  password: "Salasanasi",
  cancel: "Peruuta",
  working: "Hetki…",
  queued: "Jonossa. Apuri aloittaa tavallisesti minuutin sisällä.",
  running: "Käynnissä.",
  restarting: "Sovellus käynnistyy uudelleen…",
  restartingLong: `Jos sivu ei palaa, palauta edellinen versio palvelimella: ${ROLLBACK_HELP}`,
  cancelRequest: "Peruuta pyyntö",
  ok: "Onnistui",
  failed: "Epäonnistui",
  expired: "Vanhentui",
  cancelled: "Peruutettu",
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
  events: "Ylläpitoloki",
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

  // Palauta uusin varmuuskopio. The sentences of the server (the 400, 403, 409 and 503 answers) are shown as they come.
  restoreTitle: "Palauta uusin varmuuskopio",
  restoreSub: "Korvaa tietokannan uusimmalla ehjällä varmuuskopiolla.",
  restoreSubmit: "Palauta",
  restoreWord: "PALAUTA",
  restoreLoading: "Haetaan uusinta varmuuskopiota…",
  restoreNone: "Ehjää varmuuskopiota ei ole.",
  restorePending: "Palautus on jo pyydetty. Se tehdään, kun sovellus käynnistyy uudelleen.",
  restoreCopyLabel: "Uusin ehjä varmuuskopio",
  restoreLoses: "Varmuuskopion jälkeen tehdyt muutokset häviävät. Pankkitapahtumat haetaan uudelleen seuraavassa haussa.",
  restoreMistake: "Palautus tuo tiedot sellaisina kuin ne olivat tällöin. Jos virhe on tehty ennen tätä aikaa, se on varmuuskopiossakin.",
  restoreUndoesReset: "Tämä varmuuskopio on otettu juuri ennen tietojen tyhjennystä. Sen palautus tuo tyhjennetyt tiedot takaisin. Pankkiyhteydet pitää silti yhdistää uudelleen.",
  restoreDialog: (time: string) => [
    `Tietokanta korvataan varmuuskopiolla ajalta ${time}.`,
    "Sen jälkeen tehdyt muutokset häviävät.",
    "Sovellus käynnistyy uudelleen, ja sivu on hetken pois käytöstä.",
  ],
  restoreAsked: (time: string) => `Palautus on pyydetty. Sovellus käynnistyy uudelleen ja korvaa tietokannan varmuuskopiolla ajalta ${time}.`,
  restoreWaiting: "Odotetaan, että sovellus vastaa…",
  restoreSlow: `Sovellus ei ole vielä vastannut. Jos sivu ei palaa, käynnistä sovellus palvelimella asennuskansiossa komennolla ${START_HELP}`,
  restoreLate: "Pyynnöstä on kulunut yli 15 minuuttia, joten palautusta ei enää tehdä. Pyydä se uudelleen, kun sovellus on taas käynnissä.",
  restoreBack: "Sovellus vastaa taas. Sivun yläreunan ilmoitus kertoo, tehtiinkö palautus.",
  restoreStillPending: "Sovellus vastaa taas, mutta palautusta ei ole vielä tehty. Se tehdään, kun sovellus käynnistyy uudelleen.",
  reload: "Lataa sivu uudelleen",

  // Tyhjennä kaikki tiedot
  resetTitle: "Tyhjennä kaikki tiedot",
  resetSub: "Aloita alusta tyhjällä tietokannalla.",
  resetSubmit: "Tyhjennä",
  resetWord: "TYHJENNÄ",
  resetGoes: "Tyhjennys poistaa tilit, tapahtumat, lainat, säännöt ja muut käyttäjät. Oma tunnuksesi, palvelimen asetukset ja Enable Banking -sovellus säilyvät.",
  resetNotes: [
    "Ensin otetaan varmuuskopio. Vanhat varmuuskopiot jäävät paikoilleen, joten tiedot säilyvät niissä.",
    "Painikkeella Palauta uusin varmuuskopio tiedot saa takaisin alle vuorokauden ajan. Sen jälkeen uusin varmuuskopio on otettu jo tyhjennetystä tietokannasta.",
    "Tyhjennystä edeltävä varmuuskopio säilyy vähintään 14 päivää.",
    "Pankkiyhteydet lopetetaan. Ne pitää yhdistää uudelleen myös palautuksen jälkeen.",
  ],
  resetDialog: ["Tämä poistaa tilit, tapahtumat, lainat, säännöt ja muut käyttäjät.", "Ensin otetaan varmuuskopio.", "Sinut kirjataan ulos."],
  resetCopy: (name: string) => `Varmuuskopio ennen tyhjennystä: ${name}`,
  resetFailed: (n: number) =>
    `${n === 1 ? "1 pankkiyhteys jäi" : `${n} pankkiyhteyttä jäi`} voimaan pankissa. ${n === 1 ? "Se vanhenee" : "Ne vanhenevat"} itsestään.`,
  resetBanks: "Yhdistä pankit uudelleen, kun olet kirjautunut.",
  signIn: "Kirjaudu sisään",
};

/** The restore request lapses 15 minutes after it was made (db/startup-gate.ts MARKER_MAX_AGE_MS). */
export const REQUEST_LAPSES_MS = 15 * 60_000;
/** After this long without an answer from /api/health the card says what to do. */
export const SLOW_MS = 60_000;

/** The only two fields either request carries. The server refuses any other. */
export const confirmBody = (password: string, confirm: string): { password: string; confirm: string } => ({ password, confirm });

type RestoreView = "loading" | "none" | "pending" | "copy";
export function restoreView(state: RestoreState | null): RestoreView {
  if (!state) return "loading";
  if (state.pending) return "pending";
  return state.copy ? "copy" : "none";
}

/** What the card says while it waits for the app to answer again after the request. */
export function restoreWait(waitedMs: number): string[] {
  if (waitedMs < SLOW_MS) return [S.restoreWaiting];
  return waitedMs < REQUEST_LAPSES_MS ? [S.restoreSlow] : [S.restoreSlow, S.restoreLate];
}

/**
 * The switch for new versions is on the page when the helper is on, knows the two requests and has said where the
 * switch stands, and the install follows releases (a source install has none to follow).
 */
export function showsPrerelease(helper: HelperInfo, state: OpsSnapshot): boolean {
  return helper.status !== "off" && helper.knowsPrerelease && state.channel !== "source" && state.prerelease !== undefined;
}
/** Where the switch stands: what a request under way asks for, else what the helper last reported from the host. */
export function prereleaseOn(state: OpsSnapshot, latest: OpsRequestView | undefined): boolean {
  const asked = latest && (latest.status === "queued" || latest.status === "running") ? latest.action : "";
  if (asked === "prerelease-on" || asked === "prerelease-off") return asked === "prerelease-on";
  return state.prerelease === "yes";
}
/** The request a turn of the switch sends. The position is in the name, and no value goes with it. */
export const prereleaseAction = (on: boolean): OpsAction => (on ? "prerelease-on" : "prerelease-off");

export const LEVEL: Record<string, string> = { ok: "kunnossa", warn: "varoitus", error: "virhe" };
const KIND: Record<string, string> = { daily: "päivittäinen", "pre-update": "ennen päivitystä", "pre-reset": "ennen tyhjennystä", manual: "käsin" };
/** What the list calls a copy. The server says what a copy is (db/backup-keep.ts copyKind); the page only words it. */
export const kindLabel = (kind: string): string => KIND[kind] ?? kind;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} t`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kt`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mt`;
}
