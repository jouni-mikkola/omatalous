/** The test of rule 48 (the detector, sheets.ts, has its own tests in sheets.test.ts). */
import { dirname, posix } from "node:path";
import ts from "typescript6";
import { describe, it } from "vitest";
import { expectNoFindings, type Finding, importsOf, isTestFile, parse, readText, repoFiles } from "./lib.ts";
import { bareClasses, classesOf, type Module, ownClasses } from "./sheets.ts";

const WEB = "apps/web/src/";
const ENTRY = `${WEB}main.tsx`;

/**
 * The classes that were bare when the rule came, as `file .class`. The list only shrinks: the file imports the sheet
 * (or the class moves to a sheet its chunk loads) and its line goes.
 */
const KNOWN = [
  "apps/web/src/components/Loading.tsx .sk-plot",
  "apps/web/src/components/Loading.tsx .sk-row",
  "apps/web/src/pages/Bills.tsx .sk-row",
  "apps/web/src/components/PayerAnswers.tsx .st-rows",
  "apps/web/src/components/PayerAnswers.tsx .st-row",
  "apps/web/src/components/PayerAnswers.tsx .st-name",
  "apps/web/src/components/home/Skeleton.tsx .sk-line",
  "apps/web/src/components/loans/LoanEditor.tsx .loan-form",
  "apps/web/src/components/loans/LoanEditor.tsx .loan-fields",
  "apps/web/src/components/loans/LoanEditor.tsx .loan-field",
  "apps/web/src/components/loans/LoanEditor.tsx .loan-field-head",
  "apps/web/src/components/loans/LoanEditor.tsx .loan-interest",
  "apps/web/src/components/ops/BackupList.tsx .cut-mark",
  "apps/web/src/components/ui/DeviceLanguage.tsx .field",
  "apps/web/src/components/ui/DeviceLanguage.tsx .field-inline",
  "apps/web/src/pages/Transactions.tsx .kv",
  "apps/web/src/pages/reports/sections/ThisMonth.tsx .month-note",
];

function webModules(): Map<string, Module> {
  const known = new Set(repoFiles());
  const find = (from: string, spec: string): string | undefined => {
    if (!spec.startsWith(".")) return undefined;
    const base = posix.normalize(posix.join(dirname(from), spec));
    return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => known.has(c));
  };
  const out = new Map<string, Module>();
  for (const file of repoFiles().filter((f) => f.startsWith(WEB) && /\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !isTestFile(f))) {
    const m: Module = { imports: [], lazy: [], classes: file.endsWith(".tsx") ? classesOf(parse(file)) : [] };
    for (const ref of importsOf(file)) {
      const to = ref.typeOnly ? undefined : find(file, ref.spec);
      if (!to) continue;
      if (ts.isCallExpression(ref.node)) m.lazy.push(to);
      else m.imports.push(to);
    }
    out.set(file, m);
  }
  return out;
}

describe("repo rules: stylesheets", () => {
  it("rule 48: a class a component writes is styled by a stylesheet its page loads: a page is a chunk, and a sheet only another page imports is missing on a fresh load", () => {
    const sheets = new Map(repoFiles()
      .filter((f) => f.startsWith(WEB) && f.endsWith(".css") && f !== `${WEB}styles/base.css`)
      .map((f) => [f, ownClasses(readText(f))] as const));
    const found: Finding[] = [];
    const bare = new Set<string>();
    for (const b of bareClasses(webModules(), sheets, ENTRY)) {
      const key = `${b.file} .${b.name}`;
      bare.add(key);
      if (!KNOWN.includes(key)) found.push({ file: b.file, line: b.line, why: `.${b.name} is styled in ${b.sheet}, which ${b.root} does not load` });
    }
    for (const key of KNOWN) if (!bare.has(key)) found.push({ file: "tools/repo-rules/sheets-rules.ts", line: 1, why: `${key} is loaded with its page now: delete its line from KNOWN` });
    expectNoFindings("bare class", found, "import the stylesheet in the component that writes the class (a page's sheet stays loaded, so the order of the imports is the order of the rules).");
  });
});
