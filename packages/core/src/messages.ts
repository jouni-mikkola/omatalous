/**
 * The message catalogue: every sentence of sign-in, validation and the app's own errors, as a code with named holes.
 * The server sends the code and its parameters (and, for older clients, the finished sentence); the browser
 * formats them here. Finnish is the table the codes come from; English is a second table with the same keys, and a build or a test fails
 * for a code it lacks.
 * Decision: the household reads one plain sentence per failure; the code lets a test and a translator find it.
 */
import { DEFAULT_LANGUAGE, type Language } from "./locale.ts";
import type { FI_LATE } from "./messages-late.ts";
import { FI_FACTOR } from "./messages-factor.ts";
import { FI_SHELL } from "./messages-shell.ts";

const FI = {
  // the app's own answers
  "app.error": "Jokin meni vikaan. Yritä uudelleen.",
  "app.too_large": "Pyyntö on liian suuri.",
  "app.not_found": "Ei löydy.",
  "app.bad_request": "Virheellinen pyyntö. Lataa sivu uudelleen.",
  "app.unreachable": "Palvelimeen ei saada yhteyttä. Yritä hetken kuluttua uudelleen.",
  "app.server_status": "Palvelin ei vastannut oikein. Yritä hetken kuluttua uudelleen.",
  "app.request_failed": "Emme saaneet pyyntöä tehtyä. Yritä uudelleen.",
  "app.admin_only": "Vain ylläpitäjälle.",
  // sign-in
  "auth.bad_login": "Väärä käyttäjätunnus tai salasana.",
  "auth.too_many": "Liian monta yritystä. Yritä uudelleen {minutes} minuutin päästä.",
  "auth.busy": "Palvelin on kiireinen. Yritä hetken päästä uudelleen.",
  "auth.half_expired": "Kirjautuminen vanheni. Kirjaudu uudelleen.",
  "auth.bad_code": "Koodi on väärä.",
  "auth.login_required": "Kirjaudu sisään.",
  "auth.change_password_first": "Vaihda väliaikainen salasana ensin.",
  "auth.new_password_missing": "Anna uusi salasana.",
  "auth.password_wrong": "Salasana on väärä.",
  "auth.current_password_wrong": "Nykyinen salasana on väärä.",
  "auth.first_password_not_due": "Salasanasi ei ole väliaikainen.",
  "auth.first_password_expired": "Kirjautumisesta on yli 10 minuuttia. Kirjaudu uudelleen väliaikaisella salasanalla.",
  "auth.use_first_password": "Aseta ensimmäinen salasana kirjautumisen jälkeen avautuvalla sivulla.",
  "auth.password_unchanged": "Uusi salasana ei voi olla sama kuin vanha.",
  "auth.setup_done": "Sovellus on jo otettu käyttöön.",
  "auth.setup_code_expired": "Asennuskoodi on vanhentunut. Uuden saa komennolla docker compose exec banking node dist/node.js setup-code",
  "auth.setup_code_wrong": "Väärä asennuskoodi. Uuden saa komennolla docker compose exec banking node dist/node.js setup-code",
  "auth.username_shape": "Käyttäjätunnuksessa pitää olla 3–32 merkkiä (a–z, 0–9, . _ -).",
  "auth.username_taken": "Käyttäjätunnus on jo käytössä.",
  "auth.token_bad": "Palvelutunnus ei kelpaa.",
  "auth.token_read_only": "Palvelutunnuksella voi vain lukea.",
  "auth.token_too_many": "Liian monta yritystä. Yritä myöhemmin uudelleen.",
  "pw.too_short": "Salasanan pitää olla vähintään {min} merkkiä.",
  "pw.too_long": "Salasana on liian pitkä.",
  "pw.common": "Salasana on liian yleinen: hyökkääjät kokeilevat sitä ensimmäisenä.",
  "pw.few_chars": "Salasanassa on liian vähän eri merkkejä.",
  "pw.repeated": "Salasana on sama pätkä toistettuna.",
  "pw.sequence": "Salasana on pelkkä merkkijono näppäimistöltä, aakkosista tai numeroista.",
  // users
  "user.missing": "Käyttäjää ei löydy.",
  "user.last_admin_role": "Et voi poistaa ylläpito-oikeutta viimeiseltä ylläpitäjältä.",
  "user.delete_self": "Et voi poistaa omaa tunnustasi.",
  "user.delete_last_admin": "Viimeistä ylläpitäjää ei voi poistaa.",
  // validation
  "check.address": "Anna osoite muodossa https://talous.oma.fi (ilman polkua).",
  "check.timezone": "Tuntematon aikavyöhyke.",
  "check.sync_count": "Valitse enintään {max} hakuaikaa.",
  "check.sync_hour": "Hakuaika on tasatunti 0–23.",
  "check.history_days": "Historian pituus on {min}–{max} päivää.",
  "check.flag": "Arvon pitää olla päällä tai pois.",
  "check.date_range": "Virheellinen aikaväli.",
  "check.date": "Virheellinen päivämäärä.",
  "check.loan": "Tuntematon laina.",
  "check.body_shape": "Pyynnön sisältö on väärän muotoinen.",
  "check.field": "Tuntematon kenttä: {name}",
  "check.field_bad": "Virheellinen kenttä.",
  "check.report": "Tuntematon raportti.",
  "check.number": "Virheellinen luku.",
  "check.notice_address": "Anna ilmoitusten osoitteeksi https-osoite (esim. https://example.com/hook) tai ntfy-aihe (kirjaimia, numeroita, - ja _).",
  "check.notice_token": "Tunniste saa olla enintään 300 merkkiä ilman välilyöntejä.",
  "check.notice_needs_address": "Anna osoite ennen kuin otat ilmoitukset käyttöön.",
  "check.language": "Tuntematon kieli.",
  "check.json": "Pyynnön sisältö ei ole kelvollista JSONia.",
} as const;


const FI_EARLY = { ...FI, ...FI_SHELL, ...FI_FACTOR } as const;
/** Every Finnish code: the early table and the late one. */
type FiAll = typeof FI_EARLY & typeof FI_LATE;
/** A sentence for every code. */
type Catalogue = Record<keyof FiAll, string>;
/** The codes of the first table, the one English must also cover. */
export type BaseCodes = keyof typeof FI;

// The tables apart from this file are installed by importing them: messages-late.ts (the rest of Finnish) and
// messages-en.ts (English). The browser fetches them on its own (apps/web/src/language.ts); the server and the tests import both.
let late: Partial<Catalogue> = {};
export function installLate(table: Partial<Catalogue>): void {
  late = table;
}
let english: Catalogue | undefined;
export function installEnglish(catalogue: Catalogue): void {
  english = catalogue;
}
/** A table read for a code: Finnish is the early table with the late one over it. A code whose table is not installed yet reads as the code itself, never as another language. */
const textOf = (lang: Language, code: MessageCode): string => {
  if (lang === "fi") return (FI_EARLY as Partial<Catalogue>)[code] ?? late[code] ?? code;
  if (!english) throw new Error("The English catalogue is not installed (import @banking/core/english first).");
  return english[code];
};

export type MessageCode = keyof FiAll;

/** The names of the holes in a template: `"a {x} b {y}"` gives `"x" | "y"`. */
type Holes<S extends string> = S extends `${string}{${infer P}}${infer R}` ? P | Holes<R> : never;
export type MessageParams<C extends MessageCode> = [Holes<FiAll[C]>] extends [never] ? [] : [params: Record<Holes<FiAll[C]>, string | number>];

// A value that ends in a full stop (a date without its year, "9.10.") takes the sentence's full stop as its own: "vanhentui 9.10."
const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}((?:<\/(?:b|em|code)>)?)(\.?)/g, (whole, name: string, close: string, stop: string) => {
    if (!Object.hasOwn(values, name)) return whole;
    const value = String(values[name]);
    return `${value}${close}${value.endsWith(".") ? "" : stop}`;
  });

/** The sentence of a code in a language, with its holes filled. */
export function messageIn<C extends MessageCode>(lang: Language, code: C, ...params: MessageParams<C>): string {
  return fill(textOf(lang, code), (params[0] ?? {}) as Record<string, string | number>);
}

/** The Finnish sentence of a code: the text an older client gets beside the code. */
export function message<C extends MessageCode>(code: C, ...params: MessageParams<C>): string {
  return messageIn(DEFAULT_LANGUAGE, code, ...params);
}

/** A code a server sent, if this build knows it (an older or newer server may send another). */
const isMessageCode = (code: unknown): code is MessageCode => typeof code === "string" && (Object.hasOwn(FI_EARLY, code) || Object.hasOwn(late, code));

/** The sentence for a code and the parameters as they came over the wire; undefined for a code this build lacks. */
export function messageFromWire(code: unknown, params: unknown, lang: Language = DEFAULT_LANGUAGE): string | undefined {
  if (!isMessageCode(code)) return undefined;
  const given = typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
  // a hole with no usable value means the sentence cannot be made: the caller keeps the text the server sent
  const holes = [...textOf(lang, code).matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  if (holes.some((h) => typeof given[h] !== "string" && typeof given[h] !== "number")) return undefined;
  return fill(textOf(lang, code), given as Record<string, string | number>);
}
