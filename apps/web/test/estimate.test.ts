import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript6";
import { describe, expect, it } from "vitest";
import { approxText, Estimate } from "../src/components/Estimate.tsx";

/**
 * An estimate has one mark, "≈" before the figure or a dotted underline where the sign does not fit. The texts are read
 * from the parsed code (strings, templates, the text of elements), so a comment that names the sign is no finding.
 */

const SRC = new URL("../src/", import.meta.url);

/** The files that write "≈" themselves: the mark and the function that gives it to plain text. */
const WRITES_APPROX = new Set(["components/Estimate.tsx", "approx.ts"]);

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

describe("the mark of an estimate", () => {
  it("is written only through Estimate and approxText, so one mark means one thing", () => {
    expect(texts(parse("a.tsx", "// ≈ in a comment\nconst a = <p>≈ 3 €</p>;"))).toEqual(["≈ 3 €"]);
    const found = (readdirSync(SRC, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !WRITES_APPROX.has(f))
      .sort()
      .filter((f) => texts(parse(f, readFileSync(new URL(f, SRC), "utf8"))).some((t) => t.includes("≈")));
    expect(found, "a new ≈ by hand: use Estimate or approxText").toEqual([]);
  });

  it("puts ≈ before an estimate or the dotted underline, and leaves an exact figure as it is", () => {
    expect(renderToStaticMarkup(createElement(Estimate, { children: "1 200 €" }))).toBe('<span class="fig-approx"><span class="fig-approx-sign">≈</span>1 200 €</span>');
    expect(renderToStaticMarkup(createElement(Estimate, { mark: "line", children: "1 200 €" }))).toBe('<span class="fig-est">1 200 €</span>');
    expect(renderToStaticMarkup(createElement(Estimate, { when: false, children: "0,00 €" }))).toBe("0,00 €");
    expect(approxText("3,75 €", true)).toBe("≈ 3,75 €");
    expect(approxText("0,00 €", false)).toBe("0,00 €");
  });

  it("draws an estimate's line in a chart with the estimate token", () => {
    const css = readFileSync(new URL("styles/estimate.css", SRC), "utf8");
    expect(css).toMatch(/\.est-line \{[^}]*var\(--estimate-edge\)/);
  });
});
