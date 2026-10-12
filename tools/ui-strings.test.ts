import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { collect, counts, lines } from "./ui-strings.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "ui-strings-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PAGE = [
  'import { money } from "../format.ts";',
  "export function Page({ cents, kind }: { cents: number; kind: string }) {",
  '  console.log("Tallennus onnistui");',
  '  const label = kind === "tulot" ? "Tulot" : "Menot";',
  "  const sentence = `Saldo on ${money(cents)} tänään`;",
  "  return (",
  '    <div className="card card-sub" data-testid="saldo-kortti">',
  "      <h2>Seuraavat päivät</h2>",
  '      <button aria-label="Sulje ikkuna" title="Sulje">x</button>',
  "      <p>",
  '        Lisää saldo kohdassa <a href="#/settings">Asetukset &gt; Tilit</a>, niin näet',
  "        sen päivittäin.",
  "      </p>",
  "      <span>{label}</span><span>{sentence}</span>",
  "    </div>",
  "  );",
  "}",
];
const SERVER = [
  'import { UserError } from "../platform/errors.ts";',
  "export function route(db: Db, input: string) {",
  '  console.error("background task failed:", input);',
  '  const rows = db.prepare("SELECT name FROM accounts WHERE user_id = ?").all(input);',
  '  const sql = "UPDATE accounts SET name = ? WHERE id = ?";',
  '  if (!input) throw new UserError("Liitä koko osoite selaimen osoiteriviltä.");',
  '  if (rows.length > 3) throw new Error("Too many accounts for " + input);',
  "  return { error: `Tilejä on enintään ${rows.length}` };",
  "}",
];
const CORE = [
  'export type Kind = "income" | "expense";',
  'export const kindOf = (k: Kind) => (k === "income" ? "Tulot" : "Menot");',
  'export const month = ["tammikuussa", "income"];',
  'export const tone = { id: "warning", label: "Varoitus" };',
  'export const unit = "kk";',
  'export const one = "a";',
  "export const note = (n: number) => `Menot ovat nousseet ${n} % kuukaudessa`;",
  'export const all = (items: { name: string }[]) => `Yhteensä ${items.map((item) => item.name.toUpperCase()).filter(Boolean).join(", ")} lisätty`;',
];
const HTML = [
  '<!doctype html><html lang="fi"><head><title>Esimerkki: tietosuoja</title><style>body{color:red}</style></head>',
  "<body>",
  "<h1>Tietosuoja</h1>",
  "<p>Tämä sivu ei aseta <b>evästeitä</b>",
  "  eikä lataa mitään.</p>",
  '<img src="a.png" alt="Esimerkkikuva">',
  '<script>var msg = "Paluuosoite ei kelpaa"; var re = "^[a-z]+$";</script>',
  "</body></html>",
];
const FILES: Record<string, string[]> = {
  "apps/web/src/Page.tsx": PAGE,
  "apps/web/src/components/ops/Hidden.tsx": ["export const Hidden = () => <p>Piilotettu teksti</p>;"],
  "apps/web/src/Page.test.tsx": ["export const T = () => <p>Testiteksti</p>;"],
  "apps/web/src/test/helper.ts": ['export const s = "Testikansion teksti";'],
  "apps/server/src/routes/bank.ts": SERVER,
  "packages/core/src/words.ts": CORE,
  "relay/privacy/index.html": HTML,
};
for (const [f, text] of Object.entries(FILES)) {
  mkdirSync(join(dir, dirname(f)), { recursive: true });
  writeFileSync(join(dir, f), `${text.join("\n")}\n`);
}
const world = collect(dir);
const of = (file: string) => world.filter((r) => r.file === file).map((r) => `${r.kind} ${r.text}`);
const lineOf = (text: string[], needle: string) => text.findIndex((l) => l.includes(needle)) + 1;

describe("pnpm strings", () => {
  it("a JSX text, an aria-label, a title and a template literal with a figure give one line each, of the right kind", () => {
    expect(of("apps/web/src/Page.tsx")).toEqual([
      "literal Tulot",
      "literal Menot",
      "literal Saldo on ${money(cents)} tänään",
      "jsx Seuraavat päivät",
      "attr Sulje ikkuna",
      "attr Sulje",
      "jsx Lisää saldo kohdassa Asetukset > Tilit, niin näet sen päivittäin.",
    ]);
  });

  it("a sentence over two lines of JSX, with an inline element in it, is one line that starts where the sentence starts", () => {
    const row = world.find((r) => r.text.startsWith("Lisää saldo"));
    expect(row?.line).toBe(lineOf(PAGE, "Lisää saldo"));
    expect(lines(world)).toContain(`apps/web/src/Page.tsx:${lineOf(PAGE, "Lisää saldo")}\tjsx\tLisää saldo kohdassa Asetukset > Tilit, niin näet sen päivittäin.`);
  });

  it("an import path, a className, a data-testid, a SQL string, a console line and a compared value give none", () => {
    const all = world.map((r) => r.text).join("\n");
    for (const code of ["format.ts", "card", "saldo-kortti", "SELECT", "UPDATE", "Tallennus onnistui", "background task", "tulot"]) expect(all, code).not.toContain(code);
  });

  it("a server error is an error line; an English message of a plain Error and the SQL are not", () => {
    expect(of("apps/server/src/routes/bank.ts")).toEqual(["error Liitä koko osoite selaimen osoiteriviltä.", "error Tilejä on enintään ${rows.length}"]);
  });

  it("a lone lowercase word is an id when the code names it and a word when it does not; a unit and one letter are neither", () => {
    expect(of("packages/core/src/words.ts")).toEqual([
      "literal Tulot",
      "literal Menot",
      "literal tammikuussa",
      "literal Varoitus",
      "literal Menot ovat nousseet ${n} % kuukaudessa",
      "literal Yhteensä ${…} lisätty", // a hole longer than 60 characters is not written out
    ]);
  });

  it("a page of the relay gives its blocks, its title, its alt text and its script, with the lines of the file", () => {
    expect(of("relay/privacy/index.html")).toEqual([
      "jsx Esimerkki: tietosuoja",
      "jsx Tietosuoja",
      "jsx Tämä sivu ei aseta evästeitä eikä lataa mitään.",
      "attr Esimerkkikuva",
      "literal Paluuosoite ei kelpaa",
    ]);
    expect(world.find((r) => r.text === "Paluuosoite ei kelpaa")?.line).toBe(lineOf(HTML, "<script>"));
    expect(world.find((r) => r.text.startsWith("Tämä sivu"))?.line).toBe(lineOf(HTML, "<p>Tämä"));
  });

  it("tests, test folders and components/ops stay out; --also puts a folder back; --file reads one file", () => {
    const files = new Set(world.map((r) => r.file));
    expect([...files].filter((f) => /ops|test/.test(f))).toEqual([]);
    expect(collect(dir, { also: ["apps/web/src/components/ops"] }).map((r) => r.text)).toContain("Piilotettu teksti");
    expect(lines(collect(dir, { file: "apps/web/src/Page.tsx" }))).toEqual(lines(world).filter((l) => l.startsWith("apps/web/src/Page.tsx:")));
  });

  it("the lines are sorted by file and line, and --count gives the number per file", () => {
    const keys = world.map((r) => [r.file, r.line] as const);
    expect(keys).toEqual([...keys].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])));
    expect(counts(world)).toContain("apps/server/src/routes/bank.ts\t2");
    expect(counts(world)).toContain("apps/web/src/Page.tsx\t7");
  });
});

describe("pnpm strings on this repository", () => {
  const repo = collect();
  const text = repo.map((r) => r.text).join("\n");

  // twenty sentences of six pages, a dashboard card, the sentence builders of core, the server and the relay
  const PARTS = [
    "Kirjaudu sisään", // pages/Auth.tsx
    "Salasanat eivät täsmää.",
    "Vaihda salasana",
    "Automaattinen haku", // pages/Wizard.tsx
    "Yritä uudelleen",
    "Sinulle jaetut tilit näkyvät kohdassa Koko talous.", // pages/Overview.tsx
    "Maksettu yhteensä", // pages/Transactions.tsx
    "Tapahtumat ja kauppiaat",
    "Luokittelematta",
    "Ei kauppiaita näillä rajauksilla.", // pages/Merchants.tsx
    "Kauppias (tarkka)", // pages/Rules.tsx
    "Seuraavat 30 päivää", // components/NextDays.tsx
    "Palkkapäivä ei ole tiedossa.",
    "Tilin saldo ei ole tiedossa.",
    "Kilpailuta asuntolainan marginaali.", // core optimise
    "Tarkista korotuksen peruste vuokrasopimuksesta.",
    "Väärä käyttäjätunnus tai salasana.", // server
    "Osoite on vajaa. Liitä koko osoite.",
    "Liitä koko osoite selaimen osoiteriviltä.",
    "Tämä sivu ei aseta evästeitä", // relay/privacy
  ];

  it("has twenty sentences picked from the pages, core, the server and the relay", () => {
    expect(PARTS).toHaveLength(20);
    for (const part of PARTS) expect(text, part).toContain(part);
  });

  it("has every line in the form file:line, a tab, the kind, a tab, the text, and none that is short or only a figure or a unit", () => {
    const UNITS = new Set(["kk", "pv", "vrk", "v", "vk", "h", "min", "s", "kg", "km", "kwh", "kw", "w", "m", "l", "c", "eur"]);
    expect(repo.length).toBeGreaterThan(2000);
    for (const line of lines(repo)) expect(line, line).toMatch(/^[^\t]+:\d+\t(jsx|attr|literal|error)\t\S[^\t]*$/);
    for (const r of repo) {
      const words = r.text.toLowerCase().match(/\p{L}+/gu) ?? [];
      expect(words.join("").length, `${r.file}:${r.line} ${r.text}`).toBeGreaterThanOrEqual(2);
      expect(words.every((w) => UNITS.has(w)), `${r.file}:${r.line} ${r.text}`).toBe(false);
    }
  });

  it("runs from the command line: --file is the same lines as the whole list, an unknown option is refused", () => {
    const file = "apps/web/src/components/NextDays.tsx";
    const one = spawnSync(process.execPath, ["tools/ui-strings.mjs", "--file", file], { cwd: REPO, encoding: "utf8" });
    expect(one.status).toBe(0);
    expect(one.stdout.trimEnd().split("\n")).toEqual(lines(repo).filter((l) => l.startsWith(`${file}:`)));
    expect(spawnSync(process.execPath, ["tools/ui-strings.mjs", "--dir", "x"], { cwd: REPO, encoding: "utf8" }).status).toBe(2);
  }, 30_000); // starts node twice: a loaded machine takes over the five seconds a test gets
});
