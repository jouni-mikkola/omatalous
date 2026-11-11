import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refusalIn } from "../src/platform/refusals-en.ts";

const src = join(import.meta.dirname, "../src");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "private" ? [] : files(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

const FINNISH = /[äö]|\b(ei|ja|että|ole|Anna|Valitse|löydy)\b/;
/** A template's holes become a word, so `${n}` fills a `{1}` part. */
const filled = (s: string) => s.replace(/\$\{[^}]*\}/g, "x");

/** The literal first argument of every refusal the sources throw, and the words the sources keep in constants. */
function sentences(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const call = /(?:new (?:UserError|HttpUserError|NotFound)|\bbad|\boneOf\([^"]*|\bwrongWord)\(\s*(["`])((?:[^"`\\]|\\.)*)\1/g;
  const named = /\b(?:const|export const) (?:IN_PROGRESS|TOKEN_WHILE_ON|INSTALLERS|NO_PAIR|ROTATED|UNNAMED_MERCHANT_RULE|GONE|NOT_LINKABLE|TOO_MANY_TESTS)\s*(?::[^=]+)?=\s*\n?\s*(["`])((?:[^"`\\]|\\.)*)\1/g;
  const refuses = /\brefuse\(s, ses, ("|`)((?:[^"`\\]|\\.)*)\1/g;
  const labels = /label: "((?:[^"\\]|\\.)*)"/g;
  const says = /^\s{2}(?:token|permission|"zero-trust"|taken|zone|unreachable): "((?:[^"\\]|\\.)*)",$/gm;
  for (const file of files(src)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(call)) out.push({ file, text: filled(m[2]!) });
    for (const m of text.matchAll(refuses)) out.push({ file, text: filled(m[2]!) });
    if (file.endsWith("platform/limits.ts")) for (const m of text.matchAll(labels)) out.push({ file, text: m[1]! });
    for (const m of text.matchAll(named)) out.push({ file, text: filled(m[2]!) });
    if (file.endsWith("remote-access-cloudflare.ts")) for (const m of text.matchAll(says)) out.push({ file, text: m[1]! });
  }
  // the loans' choices say it in the second argument
  for (const m of readFileSync(join(src, "routes/loans.ts"), "utf8").matchAll(/oneOf\([^"\n]*"([^"]+)"\)/g)) out.push({ file: "routes/loans.ts", text: m[1]! });
  return out.filter((s) => FINNISH.test(s.text));
}

describe("refusals in English", () => {
  const found = sentences();
  it("reads the refusals of the sources", () => expect(found.length).toBeGreaterThan(150));
  it("has a line for every Finnish refusal", () => {
    const missing = [...new Set(found.filter((s) => refusalIn(s.text, "en") === s.text).map((s) => `${s.file.replace(src, "")}: ${s.text}`))];
    expect(missing).toEqual([]);
  });
  it("leaves no Finnish in a translated refusal", () => {
    for (const { text } of found) {
      const en = refusalIn(text, "en");
      if (en !== text) expect(en, text).not.toMatch(/[äö]|\b(ei|että|ole|löydy)\b/);
    }
  });
  it("fills the parts and keeps Finnish for Finnish readers", () => {
    expect(refusalIn("Sääntöjä voi olla enintään 200.", "en")).toBe("There can be at most 200 rules.");
    expect(refusalIn("Sääntöjä voi olla enintään 200.", "fi")).toBe("Sääntöjä voi olla enintään 200.");
    expect(refusalIn("Tiedosto on liian suuri tuotavaksi. Mitään ei tuotu.", "en")).toBe("The file is too large to import. Nothing was imported.");
    expect(refusalIn("Pyynnön enimmäiskoko (kt): anna kokonaisluku 16–4096.", "en")).toBe("Largest request (kB): give a whole number 16–4096.");
    expect(refusalIn("Jokin outo virhe.", "en")).toBe("Jokin outo virhe.");
  });
});

describe("refusals in Finnish", () => {
  const found = [...new Set(sentences().map((s) => s.text))];
  // the limits' labels and Cloudflare's short answers are parts of a sentence, and a filled part may end one
  it("read as a sentence: a capital first, a stop last", () => {
    const off = found.filter((t) => /\.\s/.test(t) || /\.$/.test(t)).filter((t) => !/^[A-ZÄÖÅ0-9"x]/.test(t) || !/[.?!)"x]$/.test(t.trim()));
    expect(off).toEqual([]);
  });
  it("name no setting of the server, no code value and no long dash", () => {
    const off = found.filter((t) => /\b[A-Z]+_[A-Z_]+\b|\b(null|undefined|NaN)\b|—/.test(t));
    expect(off).toEqual([]);
  });
  it("tell the reader what to do next where nothing else can", () => {
    expect(found).toContain("Palvelimen salausavain puuttuu. Ylläpitäjä löytää syyn palvelimen lokista.");
    expect(found).toContain("Virheellinen pyyntö. Lataa sivu uudelleen.");
    expect(found).not.toContain("Virheellinen pyyntö.");
  });
});
