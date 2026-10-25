import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MarkCell } from "../src/components/table/Cells.tsx";
import { approxText, BasisDoor, basisPerson, Estimate, Why } from "../src/components/Why.tsx";

/**
 * VT5, the owner's rule: a figure opens its basis by a tap on the figure itself. No link text says so ("Mistä luku tulee",
 * "Miksi?"), and every element that wears the door's look (`why-fig`) opens something. The texts are read from the parsed
 * code (strings, templates, the text of elements), so a comment that names the old link is no finding.
 */

const SRC = new URL("../src/", import.meta.url);

/** The words of a link to a basis, in the forms the app has used or a copy pass would write. */
const LINK_TEXT = /mistä (luku|summa|tämä|arvio) tulee|^miksi\?$|mihin (luku|summa|arvio) perustuu|näin (luku|summa) (syntyy|lasketaan)|näytä laskelma/i;

/**
 * The texts that still say it, as `file<TAB>text`, until their page's builder moves the figure onto Why. The list only
 * shrinks (empty since the private pages moved): a line whose text is gone fails the test until it goes.
 */
const LEFT: string[] = [];

/**
 * The two names a Why door takes, by the kind of its basis (`doorKind` in Why.tsx): the rows a sum adds up, or a
 * calculation (the loan figures). "Näytä laskelma" is link text anywhere else; there it is the door's own word.
 */
const DOOR_FORMS = /^(Näytä tapahtumat|Näytä laskelma): \S/;
const DOOR_WORDS = ["components/Why.tsx\tNäytä laskelma"];

/**
 * The files that still write "≈" by hand, until their page's builder moves it onto Estimate and approxText: VC2 the charts
 * and Cashflow, VC1 the pace chart, VS1 Säästövinkit, VT3 Kategoriat and Drift. A file not on it may write none. The list
 * only shrinks; while branches land in any order a moved file may stay on it for a while (0.69 checks that none is stale).
 */
const HAND_APPROX = new Set([
  "components/optimise/marks.tsx",
]);

/** The source files of the web app (tests live outside src), as their path under src and their parsed tree. */
function trees(): [string, ts.SourceFile][] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"))
    .sort()
    .map((f): [string, ts.SourceFile] => [f, parse(f, readFileSync(new URL(f, SRC), "utf8"))]);
}

const parse = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Each piece of text in the code (a string, the fixed parts of a template, the text of an element), never a comment. */
function texts(tree: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    else if (ts.isJsxText(n)) out.push(n.text.replace(/\s+/g, " ").trim());
    ts.forEachChild(n, visit);
  };
  visit(tree);
  return out.filter(Boolean);
}

/** Each element whose class names `why-fig` and that opens nothing: not a button, or no handler, or no word of what opens. */
function doorsWithoutBasis(file: string, tree: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const attrs = new Map(n.attributes.properties.flatMap((a) => (ts.isJsxAttribute(a) ? [[a.name.getText(), a.initializer?.getText() ?? ""] as const] : [])));
      // BasisDoor is a door itself (its props make the sheet it opens); its class only adds the page's layout
      if (n.tagName.getText() !== "BasisDoor" && /\bwhy-fig\b/.test(attrs.get("className") ?? "")) {
        const opens = n.tagName.getText() === "button" && attrs.has("onClick") && ["aria-expanded", "aria-haspopup", "aria-controls"].some((a) => attrs.has(a));
        if (!opens) out.push(`${file}:${tree.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
      }
      // the door itself: the figure it opens and its days
      if (n.tagName.getText() === "Why" && !(attrs.has("figure") && attrs.has("range") && attrs.has("title")))
        out.push(`${file}:${tree.getLineAndCharacterOfPosition(n.getStart()).line + 1} <Why> without figure, range or title`);
    }
    ts.forEachChild(n, visit);
  };
  visit(tree);
  return out;
}

describe("the basis of a figure opens from the figure", () => {
  it("finds the link text it refuses and passes a heading that only starts with Miksi", () => {
    for (const t of ["Mistä luku tulee", "Mistä summa tulee?", "Miksi?", "Mihin luku perustuu", "Näin luku syntyy"]) expect(t).toMatch(LINK_TEXT);
    for (const t of ["Miksi ostot puuttuvat", "Miksi muuttui?", "Näytä tapahtumat: Tulos", "Mistä tulot tulevat"]) expect(t).not.toMatch(LINK_TEXT);
  });

  const all = trees();

  it("shows no link text to a basis anywhere in the web app, beyond the list that shrinks", () => {
    expect(texts(parse("a.tsx", "// Mistä luku tulee\nconst a = <p title={`${x}. Mistä luku tulee`}>Miksi?</p>;"))).toEqual([". Mistä luku tulee", "Miksi?"]);
    // an accessible name is text too: a screen reader says it, so it may not say the link either
    const aria = texts(parse("b.tsx", 'const b = <button aria-label="Kertyi 3 €. Mistä luku tulee" onClick={t}>3 €</button>;'));
    expect(aria.filter((t) => LINK_TEXT.test(t.trim()))).toEqual(["Kertyi 3 €. Mistä luku tulee"]);
    const found = all.flatMap(([f, tree]) => texts(tree).filter((t) => LINK_TEXT.test(t.trim())).map((t) => `${f}\t${t}`));
    expect(found.filter((f) => !LEFT.includes(f) && !DOOR_WORDS.includes(f))).toEqual([]);
    expect(LEFT.filter((l) => !found.includes(l)), "the text is gone: take its line out of LEFT").toEqual([]);
  });

  it("writes the estimate's ≈ only through Why.tsx (Estimate, approxText), so one mark means one thing", () => {
    const found = all.flatMap(([f, tree]) => (f === "components/Why.tsx" ? [] : texts(tree).filter((t) => t.includes("≈")).map(() => f)));
    expect(found.filter((f) => !HAND_APPROX.has(f)), "a new ≈ by hand: use Estimate or approxText").toEqual([]);
  });

  it("gives every element with the door's look a basis to open", () => {
    expect(doorsWithoutBasis("a.tsx", parse("a.tsx", `const a = <span className="why-fig">1 €</span>; const b = <Why title="x">1</Why>;`))).toEqual(["a.tsx:1", "a.tsx:1 <Why> without figure, range or title"]);
    expect(doorsWithoutBasis("b.tsx", parse("b.tsx", `const a = <button className="why-fig" aria-expanded={o} onClick={t}>1 €</button>;`))).toEqual([]);
    expect(all.flatMap(([f, tree]) => doorsWithoutBasis(f, tree))).toEqual([]);
  });
});

describe("Why, the door", () => {
  const range = { from: "2026-10-01", to: "2026-10-31" };
  const door = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Why, { figure: "spend.month", title: "Menot", range, scope: "own", text: "1 200 €", ...props } as Parameters<typeof Why>[0], "1 200 €"));

  it("is a button whose name says the rows open, with the focus ring of every door", () => {
    const out = door({});
    expect(out).toContain('<button type="button" class="why-door why-fig" aria-haspopup="dialog" aria-label="Näytä tapahtumat: Menot 1 200 €">1 200 €</button>');
  });

  it("says a calculation opens for a loan figure, and takes no other name than the two forms", () => {
    expect(door({ figure: "loan.balance", loan: "account:a1", title: "Autolaina, velkaa", text: "1 240,00 €" })).toContain('aria-label="Näytä laskelma: Autolaina, velkaa 1 240,00 €"');
    const figures = ["spend.month", "share.part", "holdings.accounts", "bills.paid", "loans.total", "loans.interest", "loans.payments", "holdings.loans", "loan.balance", "loan.interest", "loan.payment", "loan.monthly"];
    const names = figures.map((figure) => /aria-label="([^"]*)"/.exec(door({ figure }))![1]!);
    expect(names.filter((n) => !DOOR_FORMS.test(n))).toEqual([]);
    expect(names.filter((n) => n.startsWith("Näytä laskelma"))).toHaveLength(8);
  });

  it("keeps the door's class when the caller draws something else, such as a bar", () => {
    expect(door({ className: "wf-track wf-hit", text: undefined })).toContain('class="why-door wf-track wf-hit" aria-haspopup="dialog" aria-label="Näytä tapahtumat: Menot"');
  });

  it("puts ≈ before an estimate, or the dotted underline, and says arvio in its name; an exact figure wears neither", () => {
    const approx = door({ estimate: "approx" });
    expect(approx).toContain('aria-label="Näytä tapahtumat: Menot arvio 1 200 €"');
    expect(approx).toContain('<span class="fig-approx"><span class="fig-approx-sign">≈</span>1 200 €</span>');
    expect(door({ estimate: "line" })).toContain('<span class="fig-est">1 200 €</span>');
    expect(door({})).not.toMatch(/≈|fig-est|arvio/);
  });
});

describe("BasisDoor, Estimate and approxText", () => {
  const door = (props: Partial<Parameters<typeof BasisDoor>[0]>) => renderToStaticMarkup(createElement(BasisDoor, { text: "12,40 €", open: false, onToggle: () => {}, controls: "s", ...props }));

  it("opens a sheet in place with the look and the name of every door", () => {
    expect(door({ label: "Säästöt" })).toBe('<button type="button" class="why-door why-fig" aria-expanded="false" aria-controls="s" aria-label="Näytä peruste: Säästöt 12,40 €">12,40 €</button>');
    expect(door({ estimate: true, className: "spend-fig", open: true })).toBe('<button type="button" class="why-door spend-fig" aria-expanded="true" aria-controls="s" aria-label="Näytä peruste: arvio 12,40 €"><span class="fig-approx"><span class="fig-approx-sign">≈</span>12,40 €</span></button>');
  });

  it("marks an estimate and leaves an exact figure as it is", () => {
    expect(renderToStaticMarkup(createElement(Estimate, { when: false, children: "0,00 €" }))).toBe("0,00 €");
    expect(approxText("3,75 €", true)).toBe("≈ 3,75 €");
    expect(approxText("0,00 €", false)).toBe("0,00 €");
  });
});

describe("why.css", () => {
  const css = readFileSync(new URL("styles/why.css", SRC), "utf8");

  it("draws an estimate with the estimate tokens of both looks", () => {
    for (const cls of [".est-area", ".est-line", ".est-bar"]) expect(css).toMatch(new RegExp(`\\${cls} \\{[^}]*var\\(--estimate-edge\\)`));
  });

  it("lays the panel out as a sheet from the foot on a phone", () => {
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*dialog\.why \{ margin: auto 0 0; width: 100vw;/);
  });
});

describe("the mark of a basis row", () => {
  const mark = (name: string, person: boolean) => renderToStaticMarkup(createElement(MarkCell, { name, person, size: "s" }));
  it("puts the person glyph only on a household member's row of a share, never on a payee by its name alone", () => {
    expect(basisPerson("share.part", "u:2")).toBe(true);
    expect(basisPerson("share.part", "t:9")).toBe(false);
    expect(basisPerson("spend.month", "u:2")).toBe(false);
    for (const name of ["Elisa", "Esimerkki Market", "Robert's Coffee"]) {
      const out = mark(name, basisPerson("spend.month", "t:1"));
      expect(out).toContain("data-tint=");
      expect(out).not.toContain("<svg");
    }
  });
});
