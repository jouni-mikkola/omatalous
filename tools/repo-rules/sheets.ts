/**
 * The detector of rule 48: a class a component writes is styled by a stylesheet that is loaded with it. A page is a
 * chunk of its own (`import()` in router.tsx), and a stylesheet comes with the chunk that imports it, so a class styled
 * in a sheet that only another page imports is bare on a fresh load of the page and right after a visit to the other
 * one. Text in, findings out: the rule (sheets-rules.ts) reads the files.
 */
import ts from "typescript6";

/** A module of the web app as the detector needs it. */
export interface Module {
  /** Repo paths it imports statically, stylesheets included (a type-only import is erased and left out). */
  imports: string[];
  /** Repo paths it loads with `import()`: each is the root of a chunk. */
  lazy: string[];
  /** The classes it writes in a `className`, with the line of each. */
  classes: { name: string; line: number }[];
}

export interface Bare {
  file: string;
  line: number;
  name: string;
  sheet: string;
  root: string;
}

/** The own classes of a stylesheet: `.name {`, alone or in a list, as rule 46 counts them. */
export function ownClasses(css: string): Set<string> {
  const out = new Set<string>();
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{};]*)\{/g)) {
    for (const part of rule[1]!.split(",")) {
      const m = /^\.([\w-]+)$/.exec(part.trim());
      if (m) out.add(m[1]!);
    }
  }
  return out;
}

/** The words of every string in each `className` attribute of a TSX file: the literal parts of a template and each branch of a condition. */
export function classesOf(sf: ts.SourceFile): Module["classes"] {
  const out: Module["classes"] = [];
  const add = (text: string, node: ts.Node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    for (const name of text.split(/\s+/)) if (/^[\w-]+$/.test(name)) out.push({ name, line });
  };
  const strings = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text, n);
    else if (ts.isTemplateExpression(n)) {
      add(n.head.text, n);
      for (const span of n.templateSpans) {
        strings(span.expression);
        add(span.literal.text, n);
      }
    } else ts.forEachChild(n, strings);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === "className" && n.initializer) strings(n.initializer);
    else ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * Every class a module writes whose stylesheet is not loaded with it: neither in the static closure of `entry` (always
 * loaded) nor in that of each chunk root the module is part of. A class no stylesheet owns (base.css, a class for a
 * test or a script) is not asked about.
 */
export function bareClasses(modules: ReadonlyMap<string, Module>, sheets: ReadonlyMap<string, ReadonlySet<string>>, entry: string): Bare[] {
  const closure = (root: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [root];
    while (stack.length) {
      const file = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      stack.push(...(modules.get(file)?.imports ?? []));
    }
    return seen;
  };
  const owner = new Map<string, string>();
  for (const [sheet, names] of sheets) for (const name of names) owner.set(name, sheet);
  const always = closure(entry);
  const roots = new Map<string, Set<string>>([[entry, always]]);
  for (const m of modules.values()) for (const root of m.lazy) if (!roots.has(root)) roots.set(root, closure(root));
  const out: Bare[] = [];
  for (const [file, m] of modules) {
    const chunks = [...roots].filter(([, files]) => files.has(file));
    const seen = new Set<string>();
    for (const { name, line } of m.classes) {
      const sheet = owner.get(name);
      if (!sheet || seen.has(name)) continue;
      seen.add(name);
      for (const [root, files] of chunks) if (!always.has(sheet) && !files.has(sheet)) out.push({ file, line, name, sheet, root });
    }
  }
  return out;
}
