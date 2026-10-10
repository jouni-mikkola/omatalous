/**
 * Rules 4 and 10 of the repo rules: the writing conventions of CLAUDE.md that can be checked by machine.
 * No em dash anywhere in text we write, and nothing English in what the browser shows.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { type Finding, expectNoFindings, lineIn, lineOf, parse, plainString, repoFiles, ROOT, sourceFiles, walk } from "./lib.ts";

describe("repo rules: text", () => {
  it("rule 4: no em dash (U+2014, also as an escape or an HTML entity) in any tracked regular text file", () => {
    // Every form is built from parts, so this file holds none of them and is scanned like every other file.
    const BS = "\\";
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const FORMS: { re: RegExp; name: string }[] = [
      { re: new RegExp(escape(String.fromCharCode(0x2014))), name: "em dash" },
      { re: new RegExp(escape(`${BS}u2014`), "i"), name: "escaped em dash (JS string)" },
      { re: new RegExp(escape(`${BS}u{2014}`), "i"), name: "escaped em dash (JS code point)" },
      { re: new RegExp(`${escape(`${BS}2014`)}(?![0-9a-f])`, "i"), name: "escaped em dash (CSS)" },
      { re: new RegExp(escape(`&${"mdash"};`), "i"), name: "HTML entity for the em dash" },
      { re: new RegExp(escape(`&#${"8212"};`)), name: "numeric entity for the em dash" },
      { re: new RegExp(escape(`&#x${"2014"};`), "i"), name: "hex entity for the em dash" },
    ];
    // Audit material and its prototypes: tools/style-lint.mjs there names the character on purpose, and the notes are
    // not part of the product or its docs. Nothing else is excluded.
    const EXCLUDED = [".claude/plan/research/"];
    const found: Finding[] = [];
    let scanned = 0;
    for (const file of repoFiles()) {
      if (EXCLUDED.some((p) => file.startsWith(p))) continue;
      const buf = readFileSync(resolve(ROOT, file));
      if (buf.subarray(0, 8000).includes(0)) continue; // images and other binary files
      scanned++;
      // a cheap test for the whole file first: the lines are looked at only when something may match
      const text = buf.toString("utf8");
      if (!FORMS.some((f) => f.re.test(text))) continue;
      text.split("\n").forEach((line, i) => {
        const form = FORMS.find((f) => f.re.test(line));
        if (form) found.push({ file, line: i + 1, why: `${form.name}: ${line.trim().slice(0, 80)}` });
      });
    }
    expect(scanned, "the scan found the text files").toBeGreaterThan(200);
    expectNoFindings("em dash", found, "rewrite the sentence with a comma, a colon, parentheses or two sentences (CLAUDE.md, Conventions: Writing).");
  });

  it("rule 10: no English function words in the text the browser shows (apps/web/src)", () => {
    // Words that are English and not Finnish. Left out on purpose: on, to (to is Thursday), in, at, an, as, me, no, if (an insurer).
    const ENGLISH = new Set(
      "the and or of with for from you your this that these those are is was were be been have has will would should can could not please here there what when where which how why about into than then they their our but".split(" "),
    );
    // Text that stays English, and what it is. An entry whose text is gone must be removed (the list only shrinks).
    const ALLOWED: { file: string; text: string }[] = [
      // Enable Banking's own option names, quoted in the instructions for its control panel: what the user sees on enablebanking.com
      { file: "apps/web/src/pages/settings/InstanceForms.tsx", text: "Generate outside the browser and import public certificate" },
      { file: "apps/web/src/pages/settings/InstanceForms.tsx", text: "Generate in the browser" },
    ];
    // JSX attributes that never hold text for the user: styling, addresses, identity, form wiring and SVG drawing
    const NOT_TEXT = new Set(
      (
        "className href to id key type role value name htmlFor src rel target autoComplete lang style " +
        "d viewBox x y x1 x2 y1 y2 cx cy r rx ry width height points transform fill stroke strokeWidth strokeLinecap strokeLinejoin " +
        "strokeDasharray strokeDashoffset strokeOpacity fillOpacity opacity textAnchor dominantBaseline preserveAspectRatio xmlns " +
        "clipPath mask offset stopColor stopOpacity gradientUnits gradientTransform patternUnits filter markerEnd markerStart vectorEffect"
      ).split(" "),
    );
    // Files whose every string is shown to the user (a message table, error texts), read as a whole
    const WHOLE_FILES = ["apps/web/src/components/ops/ops-strings.ts", "apps/web/src/api.ts"];
    // lowercase codes such as "check-update" or "same-origin" are identifiers, not text
    const CODE = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
    // an address or a path has no spaces: "https://..." and "./scripts/update.sh"
    const ADDRESS = /^(https?:\/\/|\.{0,2}\/)\S*$/;
    const COMPARISONS = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);
    const isLiteral = (n: ts.Node) => plainString(n) !== undefined;

    const found: Finding[] = [];
    const seenAllowed = new Set<number>();
    const reported = new Set<string>();
    let pieces = 0;
    const webFiles = sourceFiles("apps/web/src/");
    for (const file of webFiles) {
      const sf = parse(file);
      const check = (text: string, line: number, code: boolean) => {
        const flat = text.replace(/\s+/g, " ").trim();
        if (!flat || (code && (CODE.test(flat) || ADDRESS.test(flat)))) return;
        pieces++;
        const hit = (flat.toLowerCase().match(/[a-zäöå]+/g) ?? []).find((w) => ENGLISH.has(w));
        if (!hit) return;
        const allowed = ALLOWED.findIndex((a) => a.file === file && a.text === flat);
        if (allowed >= 0) seenAllowed.add(allowed);
        else if (!reported.has(`${file}:${line}:${flat}`)) {
          reported.add(`${file}:${line}:${flat}`);
          found.push({ file, line, why: `English word "${hit}" in UI text: ${flat.slice(0, 70)}` });
        }
      };
      /** The strings an expression can show. A string a value is compared with, a key and a type are not text. */
      const strings = (root: ts.Node) => {
        const go = (n: ts.Node): void => {
          const s = plainString(n);
          if (s !== undefined) return check(s, lineOf(sf, n), true);
          if (ts.isTemplateExpression(n)) check(n.head.text, lineOf(sf, n), true);
          if (ts.isBinaryExpression(n) && COMPARISONS.has(n.operatorToken.kind)) {
            for (const side of [n.left, n.right]) if (!isLiteral(side)) go(side);
            return;
          }
          if (ts.isCaseClause(n)) return n.statements.forEach(go);
          if (ts.isPropertyAssignment(n)) return go(n.initializer);
          // JSX inside the expression is read by the walk of the file, so its class names and links are not text
          if (ts.isTypeNode(n) || ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) return;
          if (ts.isTemplateExpression(n)) {
            for (const span of n.templateSpans) {
              go(span.expression);
              check(span.literal.text, lineOf(sf, n), true);
            }
            return;
          }
          ts.forEachChild(n, go);
        };
        go(root);
      };
      walk(sf, (n) => {
        if (ts.isJsxText(n)) {
          const lead = /^\s*/.exec(n.text)![0].length;
          check(n.text, sf.getLineAndCharacterOfPosition(n.pos + lead).line + 1, false);
        } else if (ts.isJsxAttribute(n) && n.initializer) {
          const name = ts.isIdentifier(n.name) ? n.name.text : "";
          if (!name || NOT_TEXT.has(name) || name.startsWith("data-")) return false;
          if (ts.isStringLiteral(n.initializer)) check(n.initializer.text, lineOf(sf, n), true);
          else strings(n.initializer);
          return false;
        } else if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
          // {cond ? "Tallenna" : "Peruuta"} as a child; JSX inside it is visited by this walk as well
          for (const child of n.children) if (ts.isJsxExpression(child) && child.expression) strings(child.expression);
        } else if (ts.isCallExpression(n) && n.arguments[0]) {
          // confirm() and alert() show their first argument
          const callee = n.expression;
          const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "window" ? callee.name.text : "";
          if (name === "confirm" || name === "alert") strings(n.arguments[0]);
        }
      });
      if (WHOLE_FILES.includes(file)) strings(sf);
    }
    for (const f of WHOLE_FILES) expect(webFiles, `${f} is scanned`).toContain(f);
    expect(pieces, "the scan found the UI text").toBeGreaterThan(300);
    ALLOWED.forEach((a, i) => {
      if (!seenAllowed.has(i)) found.push({ file: "tools/repo-rules/text-rules.ts", line: lineIn("tools/repo-rules/text-rules.ts", a.text), why: `${a.file} no longer has the allowed text "${a.text}": remove the entry from ALLOWED` });
    });
    expectNoFindings("English in UI text", found, "write the text in Finnish (CLAUDE.md: everything the browser shows is Finnish). A name that must stay English goes on ALLOWED in tools/repo-rules/text-rules.ts with a reason.");
  });
});
