import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { DEFAULT_LANGUAGE, formatEur, formatFiDate, formatFiDateIn, formatFiDayMonth, formatFiRange, formatFiRangeIn, isLanguage, LANGUAGES, LOCALE, localeOf, type MessageCode, message, messageFromWire, messageIn } from "../src/index.ts";

const holesOf = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const filled = (text: string) => Object.fromEntries(holesOf(text).map((h) => [h, "x"]));

const SAME_IN_BOTH = new Set(["set.app.application_id_12345678_abcd", "set.mem.instr_app"]);

describe("message catalogue", () => {
  it("gives a value that ends in a full stop the sentence's own: a date without its year", () => {
    expect(message("conn.lapsed_on", { bank: "OP", date: "1.10." })).toBe("OP: yhteys vanhentui 1.10.");
    expect(message("conn.lapsed_on", { bank: "OP", date: "1.10.2025" })).toBe("OP: yhteys vanhentui 1.10.2025.");
    expect(messageFromWire("conn.lapsed_on", { bank: "OP", date: "1.10." })).toBe("OP: yhteys vanhentui 1.10.");
  });

  // `fill` drops the full stop after a value that ends in one, so a hole whose full stop makes an ordinal ("{day}. päivä") must take a number
  it("has a full stop inside a sentence only after a day number", () => {
    const files = [
      ...readdirSync(new URL("../src/", import.meta.url)).filter((f) => /^messages.*\.ts$/.test(f)),
      ...readdirSync(new URL("../src/english/", import.meta.url)).map((f) => `english/${f}`),
    ];
    const ordinals = files.flatMap((f) => [...readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8").matchAll(/^  "[a-z_.0-9]+": ".*?\{(\w+)\}(?:<\/(?:b|em|code)>)?\. ?[a-zåäö(]/gm)].map((m) => m[1]));
    expect(ordinals.length).toBeGreaterThan(0);
    expect([...new Set(ordinals)]).toEqual(["day"]);
    expect(message("rep.month_spent", { spent: "120 €", day: 9 })).toBe("Olet käyttänyt rahaa 120 € kuun 9. päivään mennessä.");
  });

  it("says who failed and what to do next, not a passive or a bare failure", () => {
    const codes = ["card_file.err_save", "app.request_failed", "set.brt.the_test_failed", "load.failed"] as const;
    for (const code of codes) {
      const fi = message(code);
      expect(fi, code).not.toMatch(/ei voitu|epäonnistui/i);
      expect(fi, code).toMatch(/^Emme .+\. Yritä uudelleen\.$/);
      expect(messageIn("en", code), code).toMatch(/^We .+\. Try again\.$/);
    }
  });

  it("fills the holes of a code", () => {
    expect(message("auth.too_many", { minutes: 3 })).toBe("Liian monta yritystä. Yritä uudelleen 3 minuutin päästä.");
    expect(message("auth.bad_login")).toBe("Väärä käyttäjätunnus tai salasana.");
    expect(messageIn("en", "auth.too_many", { minutes: 3 })).toBe("Too many attempts. Try again in 3 minutes.");
    expect(messageIn("en", "auth.bad_login")).toBe("Wrong username or password.");
  });

  it("formats a code from the wire in the reader's language and ignores one it does not know", () => {
    expect(messageFromWire("check.history_days", { min: 30, max: 730 })).toBe("Historian pituus on 30–730 päivää.");
    expect(messageFromWire("check.history_days", { min: 30, max: 730 }, "en")).toBe("The history is 30–730 days long.");
    expect(messageFromWire("check.field", { name: "x" })).toBe("Tuntematon kenttä: x");
    expect(messageFromWire("no.such_code", {})).toBeUndefined();
    // a hole with no value: the caller falls back to the text the server sent
    expect(messageFromWire("auth.too_many", {})).toBeUndefined();
    expect(messageFromWire("auth.too_many", {}, "en")).toBeUndefined();
    expect(messageFromWire("check.field", { name: {} })).toBeUndefined();
    expect(messageFromWire(undefined, undefined)).toBeUndefined();
    expect(messageFromWire("constructor", {})).toBeUndefined();
  });

  // The Done-when of the roadmap: a code with no English text fails here (and the type of the table fails the build).
  it("has an English text for every code, with the same holes, and no Finnish letters in it", () => {
    const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    const rows = (table: string) => new Map([...table.matchAll(/^  "([a-z_.0-9]+)": "(.*)",$/gm)].map((m) => [m[1]!, m[2]!]));
    // one file per area: its Finnish table (messages-<area>.ts), and its English one (english/<area>.ts); the first table's English is in messages-en.ts
    const areas = readdirSync(new URL("../src/", import.meta.url)).filter((f) => /^messages-.+\.ts$/.test(f) && !["messages-en.ts", "messages-late.ts"].includes(f));
    const [fi, en] = [new Map<string, string>(), new Map<string, string>()];
    const sameOk = new Set<string>();
    const base = read("messages.ts");
    for (const [k, v] of rows(base.slice(base.indexOf("const FI = {"), base.indexOf("} as const;")))) fi.set(k, v);
    const first = read("messages-en.ts");
    for (const [k, v] of rows(first.slice(first.indexOf("const EN: Record"), first.indexOf("installEnglish(")))) en.set(k, v);
    for (const file of areas.sort()) {
      for (const [k, v] of rows(read(file))) {
        fi.set(k, v);
        // an example that reads the same in both languages
        if (SAME_IN_BOTH.has(k)) sameOk.add(k);
      }
      for (const [k, v] of rows(read(`english/${file.slice("messages-".length)}`))) en.set(k, v);
    }
    // the same codes whatever the order of the areas
    expect([...en.keys()].sort()).toEqual([...fi.keys()].sort());
    expect(fi.size).toBeGreaterThan(50);
    for (const code of fi.keys() as Iterable<MessageCode>) {
      const sentence = messageIn("en", code, filled(fi.get(code)!) as never);
      expect(sentence.trim(), code).not.toBe("");
      // a text that is only holes and marks ("{a}. {b}") reads the same in both languages
      if (!sameOk.has(code) && /\p{L}/u.test(fi.get(code)!.replace(/\{\w+\}/g, ""))) expect(sentence, code).not.toBe(messageIn("fi", code, filled(fi.get(code)!) as never));
      expect(sentence, code).not.toMatch(/[äöå{}]/i);
    }
    for (const [code, text] of fi) expect(holesOf(en.get(code)!), code).toEqual(holesOf(text));
  });

  it("names the languages once: Finnish is the default, and a stored value is checked against the list", () => {
    expect(LANGUAGES).toEqual(["fi", "en"]);
    expect(DEFAULT_LANGUAGE).toBe("fi");
    expect(LOCALE).toBe("fi-FI");
    expect(localeOf("en")).toBe("en-GB");
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("sv")).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });

  it("writes sums and dates the way the language does", () => {
    expect(formatEur(123456).replace(/\s/g, " ")).toBe("1 234,56 €");
    expect(formatEur(123456, true, "en")).toBe("€1,234.56");
    expect(formatEur(-50, false, "en")).toBe("-€1");
    expect(formatFiDate("2026-08-01")).toBe("1.8.2026");
    expect(formatFiDate("2026-08-01", "en")).toBe("1/8/2026");
    expect(formatFiRange("2026-09-10", "2026-09-30")).toBe("10.–30.9.2026");
    expect(formatFiRange("2026-09-10", "2026-09-30", "en")).toBe("10/9/2026–30/9/2026");
    expect(formatFiRange("2026-09-10", "2026-09-10", "en")).toBe("10/9/2026");
    expect(formatFiRange("2026-09-01", "2026-10-23")).toBe("1.9.–23.10.2026");
    expect(formatFiRange("2025-10-01", "2026-09-30")).toBe("1.10.2025–30.9.2026");
    expect(formatFiRange("2025-10-01", "2026-09-30", "en")).toBe("1/10/2025–30/9/2026");
    expect(formatFiRange("2026-09-10", "2026-09-10")).toBe("10.9.2026");
  });

  it("leaves the year of `today` out of a day and of a period, and keeps any other year", () => {
    expect(formatFiDayMonth("2026-08-01")).toBe("1.8.");
    expect(formatFiDayMonth("2026-08-01", "en")).toBe("1/8");
    expect(formatFiDateIn("2026-08-01", "2026-11-11")).toBe("1.8.");
    expect(formatFiDateIn("2026-08-01", "2026-11-11", "en")).toBe("1/8");
    expect(formatFiDateIn("2025-08-01", "2026-11-11")).toBe("1.8.2025");
    expect(formatFiDateIn("2027-08-01", "2026-11-11", "en")).toBe("1/8/2027");
    expect(formatFiRangeIn("2026-09-10", "2026-09-30", "2026-11-11")).toBe("10.–30.9.");
    expect(formatFiRangeIn("2026-09-01", "2026-10-23", "2026-11-11")).toBe("1.9.–23.10.");
    expect(formatFiRangeIn("2026-09-10", "2026-09-10", "2026-11-11")).toBe("10.9.");
    expect(formatFiRangeIn("2026-09-10", "2026-09-30", "2026-11-11", "en")).toBe("10/9–30/9");
    expect(formatFiRangeIn("2025-09-10", "2025-09-30", "2026-11-11")).toBe("10.–30.9.2025");
    expect(formatFiRangeIn("2025-10-01", "2026-09-30", "2026-11-11")).toBe("1.10.2025–30.9.2026");
    expect(formatFiRangeIn("2026-12-01", "2027-01-31", "2026-11-11", "en")).toBe("1/12/2026–31/1/2027");
  });
});
