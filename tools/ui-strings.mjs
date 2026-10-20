// @ts-check
/**
 * `pnpm strings`: every text the browser can show, one line each, sorted by file and line:
 *   file:line<TAB>kind<TAB>text
 * Kinds: jsx (the text of an element, its inline children and the code between them written as it is), attr (a title,
 * aria-label, placeholder or alt, and a prop that carries text), literal (a string or template literal in the web app,
 * the sentence builders of core and the scripts of the relay pages), error (a text of the server that reaches the page).
 * A template hole or a JSX hole stays as written (`${money(x)}`, `{count}`), or becomes `${…}` when it is long.
 *   pnpm -s strings                          all of it (without -s pnpm prints two lines of its own first)
 *   pnpm -s strings --file apps/web/src/pages/Bills.tsx    one file, wherever it is
 *   pnpm -s strings --count                  file<TAB>number
 *   pnpm -s strings --also apps/web/src/components/ops     a folder that is left out by default
 * To narrow the list to a folder, filter the first column: `pnpm -s strings | grep '^apps/web/src/pages/'`.
 * Where it reads: apps/web/src (not components/ops, not tests), packages/core/src, apps/server/src (the messages of
 * the errors the page shows, and any text with ä, ö or å) and the pages of relay/. The files are parsed with the
 * TypeScript compiler that is a dev dependency, so a string is told from code by where it stands, not by grep.
 * Cannot see: a sentence that is put together from parts at run time (`a + b`, a word chosen by a table in another
 * file), and a lowercase word with no ä or ö that stands alone (`"maksu"` passed to plural): it is taken for an id.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {{ file: string, line: number, kind: "jsx" | "attr" | "literal" | "error", text: string }} Row */
/** @typedef {{ kind: Row["kind"] | undefined, relaxed: boolean }} Ctx what a string found here is, and whether a one-word value counts */

/** Folders that hold texts. A folder in `skip` changes until its release; `--also` adds it back. */
const AREAS = [
  { dir: "apps/web/src", skip: ["apps/web/src/components/ops"] },
  { dir: "packages/core/src", skip: [] },
  { dir: "apps/server/src", skip: [] },
  { dir: "relay", skip: [] },
];

/** Elements that run on inside a sentence: their text joins the text around them. */
const INLINE = new Set("a abbr b bdi code del em i ins kbd mark q s small span strong sub sup time u".split(" "));

/** Props that never hold text for a person: styling, addresses, identity, form wiring and SVG drawing. */
const NOT_TEXT = new Set(
  (
    "className class href to id key type role value name htmlFor src rel target autoComplete lang style ref as variant size tone color align mode kind status level icon component inputMode pattern min max step accept method action media sizes loading crossOrigin tabIndex colSpan rowSpan " +
    "d viewBox x y x1 x2 y1 y2 cx cy r rx ry width height points transform fill stroke strokeWidth strokeLinecap strokeLinejoin strokeDasharray strokeDashoffset strokeOpacity fillOpacity opacity textAnchor dominantBaseline preserveAspectRatio xmlns clipPath mask offset stopColor stopOpacity gradientUnits gradientTransform patternUnits filter markerEnd markerStart vectorEffect"
  ).split(" "),
);
/** Props that always hold text, so a one-word value counts. Every other aria-* prop is a state or an id. */
const TEXT_ATTRS = new Set("title alt placeholder aria-label aria-description aria-placeholder aria-roledescription aria-valuetext".split(" "));

/** Calls whose arguments are code: logs, storage, the DOM, patterns, SQL, headers, class lists. The short deny list. */
const DENY_CALLS = new Set(
  "require fetch RegExp Symbol prepare exec header setHeader getItem setItem removeItem querySelector querySelectorAll getElementById addEventListener removeEventListener setAttribute getAttribute matchMedia includes startsWith endsWith indexOf lastIndexOf split test toLocaleString toLocaleDateString toLocaleTimeString cx clsx classNames".split(" "),
);
/** Objects whose methods take code: `console.error(...)`, `localStorage.getItem(...)`, `new Intl.NumberFormat("fi-FI")`. */
const DENY_OBJECTS = new Set(["console", "localStorage", "sessionStorage", "process", "JSON", "Intl"]);

/** Errors of the server whose message the page shows (UpstreamError: the second argument), see `onError` in app.ts. */
const SERVER_ERRORS = new Set(["UserError", "HttpUserError", "TooManyAttempts", "NotFound", "LinkFailure", "UpstreamError"]);
/** Properties of an object the server sends whose value is a sentence. */
const SERVER_PROPS = new Set(["error", "userMessage", "message", "detail", "text", "reason", "summary", "label", "title", "headline", "hint", "note", "description"]);

/** Properties whose string value is an id or a kind of the code, not a text. */
const ID_PROPS = new Set("id key kind group type source status area tone variant provider code slug reason state role level severity cadence".split(" "));

const COMPARE = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.InKeyword]);

const UNITS = new Set("kk pv vrk v vk h min s kg km kwh kw w m l c eur".split(" "));
const SQL = /\b(SELECT|FROM|WHERE|ORDER BY|GROUP BY|INSERT INTO|DELETE FROM|ON CONFLICT|PRAGMA|CREATE TABLE|ALTER TABLE|COALESCE\(|VALUES \(|UPDATE \w+ SET)\b/;
const REGEX = /\(\?[:!=<]|\\[bdswBDSW.([]|\[\^?[^\]\s]+\][+*?{]|\.\*|\\u[0-9a-f]{4}/;
const CSS = /\b(var|calc|rgba?|hsla?|translate[XY]?|rotate|scale|linear-gradient)\(|^#[0-9a-f]{3,8}$|^\d+(\.\d+)?(px|rem|em|%|vh|vw|ms|s)(\s|$)/i;
const ADDRESS = /^(https?:\/\/|\.{0,2}\/|#\/?|mailto:)\S*$|^[\w./-]+\.(ts|tsx|js|mjs|css|json|html|svg|png|jpg|sql|sh|md|txt|env|csv|ics|pem|db)$|charset=|^\w+=\S*$/;

const NAMED = /** @type {Record<string, string>} */ ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", shy: "", ndash: "\u2013", hellip: "\u2026" });
/** HTML entities as a browser reads them. */
const decode = (/** @type {string} */ s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] !== "#") return NAMED[g.toLowerCase()] ?? m;
    const code = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  });
const tidy = (/** @type {string} */ s) => s.replace(/\s+/g, " ").trim();

/** The text of a JSX text node as React renders it: lines trimmed, empty lines gone, the rest joined by one space. */
function jsxText(/** @type {string} */ raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let out = "";
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, " ");
    if (i > 0) l = l.trimStart();
    if (i < lines.length - 1) l = l.trimEnd();
    if (l) out += (out ? " " : "") + l;
  });
  return decode(out);
}

/** At least two letters outside the holes, and not only a unit (kk, pv, kWh). */
function worth(/** @type {string} */ bare) {
  const words = bare.toLowerCase().match(/\p{L}+/gu) ?? [];
  return words.join("").length >= 2 && !words.every((w) => UNITS.has(w));
}

/**
 * True for code or data in a string: an id, a route, a file name, a class list, a pattern, SQL, CSS, a bank keyword.
 * A lone lowercase word is an id when the code names it somewhere (`names`: identifiers and compared or typed
 * strings), else a word: "income" is a name in the code, "tammikuussa" is not.
 */
function isCode(/** @type {string} */ bare, /** @type {ReadonlySet<string>} */ names) {
  const flat = tidy(bare);
  if (!/\p{Ll}/u.test(flat) || SQL.test(flat) || REGEX.test(flat) || CSS.test(flat) || ADDRESS.test(flat)) return true;
  const words = flat.split(" ");
  if (words.length === 1) {
    const w = flat.replace(/[.:;,!?\u2026]+$/u, "");
    if (/[äöåÄÖÅ]/.test(w) || /^\p{Lu}[\p{Ll}-]*\p{Ll}$/u.test(w)) return false;
    return !/^[a-z]+$/.test(w) || names.has(w);
  }
  return words.every((w) => /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(w)) && words.some((w) => /[-_0-9]/.test(w));
}

const isString = (/** @type {ts.Node} */ n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

/** A file as a syntax tree. A `.tsx` file is read as JSX, a `.mjs` file and the script of a page as JavaScript. */
function parse(/** @type {string} */ file, /** @type {string} */ src, script = false) {
  return ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, script || /\.m?js$/.test(file) ? ts.ScriptKind.JS : file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** Adds the names the code uses to `names`: every identifier, and every string that is compared with or typed as a value. */
function addNames(/** @type {ts.Node} */ root, /** @type {Set<string>} */ names) {
  const go = (/** @type {ts.Node} */ n) => {
    if (ts.isIdentifier(n)) names.add(n.text);
    else if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) names.add(n.literal.text);
    else if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) names.add(n.expression.text);
    else if (ts.isPropertyAssignment(n) && ts.isStringLiteral(n.initializer) && ts.isIdentifier(n.name) && ID_PROPS.has(n.name.text)) names.add(n.initializer.text);
    else if (ts.isBinaryExpression(n) && COMPARE.has(n.operatorToken.kind)) for (const s of [n.left, n.right]) if (ts.isStringLiteral(s)) names.add(s.text);
    ts.forEachChild(n, go);
  };
  go(root);
}

/**
 * The texts of one TypeScript, TSX or JavaScript file. In a server file only the sinks count: the message of a
 * user-facing error, the value of a property that holds a sentence, and any literal with ä, ö or å.
 * @param {string} file @param {ts.SourceFile} sf @param {ReadonlySet<string>} names @param {number} lineOffset
 * @returns {Row[]}
 */
function scanCode(file, sf, names, lineOffset = 0) {
  const server = file.startsWith("apps/server/");
  /** @type {Row[]} */
  const rows = [];
  /** Nodes whose text is already in a line: a hole that was printed, an inline element that was folded. */
  const done = new Set();
  const lineOf = (/** @type {number} */ pos) => sf.getLineAndCharacterOfPosition(pos).line + 1 + lineOffset;
  /** A hole as written, or undefined when it is too long to read in a sentence. */
  const hole = (/** @type {ts.Node} */ e) => {
    const s = tidy(e.getText(sf));
    return s.length > 60 ? undefined : s;
  };
  const hasJsx = (/** @type {ts.Node} */ e) => {
    let found = false;
    const go = (/** @type {ts.Node} */ n) => {
      if (found) return;
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true;
      else ts.forEachChild(n, go);
    };
    go(e);
    return found;
  };

  /** A string or template as `text` (holes written out), `bare` (holes as \0) and the hole expressions printed. */
  const textOf = (/** @type {ts.Node} */ n) => {
    if (isString(n)) {
      const t = /** @type {ts.StringLiteral} */ (n).text;
      const text = ts.isJsxAttribute(n.parent) ? decode(t) : t;
      return { text, bare: text, used: /** @type {ts.Node[]} */ ([]) };
    }
    if (!ts.isTemplateExpression(n)) return undefined;
    let text = n.head.text;
    let bare = n.head.text;
    /** @type {ts.Node[]} */
    const used = [];
    for (const span of n.templateSpans) {
      const h = hole(span.expression);
      text += (h === undefined ? "${…}" : "${" + h + "}") + span.literal.text;
      bare += "\0" + span.literal.text;
      if (h !== undefined) used.push(span.expression);
    }
    return { text, bare, used };
  };

  const take = (/** @type {ts.Node} */ n, /** @type {Ctx} */ ctx) => {
    const t = textOf(n);
    if (!t || !worth(t.bare)) return;
    const kind = ctx.kind ?? (server && /[äöåÄÖÅ]/.test(t.bare) ? "error" : server ? undefined : "literal");
    if (!kind || (!ctx.relaxed && isCode(t.bare, names))) return;
    rows.push({ file, line: lineOf(n.getStart(sf)), kind, text: tidy(t.text) });
    for (const u of t.used) done.add(u);
  };

  /** One element: its text and what runs on inside it as one line, then everything inside it on its own. */
  const element = (/** @type {ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement} */ n, /** @type {Ctx} */ ctx) => {
    const tagOf = (/** @type {ts.JsxElement | ts.JsxSelfClosingElement} */ e) => (ts.isJsxElement(e) ? e.openingElement.tagName : e.tagName).getText(sf);
    if (!ts.isJsxSelfClosingElement(n)) {
      if (!done.has(n)) {
        const acc = { text: "", bare: "", pos: -1, used: /** @type {ts.Node[]} */ ([]) };
        const flow = (/** @type {readonly ts.JsxChild[]} */ children) => {
          for (const c of children) {
            if (ts.isJsxText(c)) {
              const t = jsxText(c.text);
              if (t.trim() && acc.pos < 0) acc.pos = c.pos + (/^\s*/.exec(c.text)?.[0].length ?? 0);
              acc.text += t;
              acc.bare += t;
            } else if (ts.isJsxExpression(c)) {
              const e = c.expression;
              if (!e) continue;
              if (acc.pos < 0) acc.pos = c.getStart(sf);
              if (isString(e)) {
                const t = /** @type {ts.StringLiteral} */ (e).text;
                acc.text += t;
                acc.bare += t;
                acc.used.push(c);
                continue;
              }
              const h = hasJsx(e) ? undefined : hole(e);
              acc.text += h === undefined ? "{…}" : `{${h}}`;
              acc.bare += "\0";
              if (h !== undefined) acc.used.push(c);
            } else if (ts.isJsxElement(c) && INLINE.has(tagOf(c))) {
              done.add(c);
              flow(c.children);
            } else {
              const tag = ts.isJsxFragment(c) ? "" : tagOf(c);
              acc.text += /^[A-Z]/.test(tag) ? ` <${tag} /> ` : " ";
              acc.bare += /^[A-Z]/.test(tag) ? "\0" : " ";
            }
          }
        };
        flow(n.children);
        if (worth(acc.bare)) {
          rows.push({ file, line: lineOf(acc.pos), kind: "jsx", text: tidy(acc.text) });
          for (const u of acc.used) done.add(u);
        }
      }
    }
    if (!ts.isJsxFragment(n)) for (const a of (ts.isJsxElement(n) ? n.openingElement : n).attributes.properties) visit(a, ctx);
    if (!ts.isJsxSelfClosingElement(n)) for (const c of n.children) if (!ts.isJsxText(c)) visit(c, ctx);
  };

  const attribute = (/** @type {ts.JsxAttribute} */ n) => {
    const name = n.name.getText(sf);
    const text = TEXT_ATTRS.has(name);
    if (!text && (NOT_TEXT.has(name) || name.startsWith("data-") || name.startsWith("aria-") || /^on[A-Z]/.test(name))) return;
    const init = n.initializer;
    if (init && ts.isStringLiteral(init)) take(init, { kind: "attr", relaxed: text });
    else if (init && ts.isJsxExpression(init) && init.expression) visit(init.expression, { kind: "attr", relaxed: text });
  };

  const visit = (/** @type {ts.Node} */ n, /** @type {Ctx} */ ctx) => {
    if (done.has(n)) return;
    // types, imports and enums hold names, never sentences; a tagged template is SQL or CSS; "use strict" is a directive
    if (ts.isTypeNode(n) || ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n) || ts.isTaggedTemplateExpression(n)) return;
    if (ts.isExpressionStatement(n) && ts.isStringLiteral(n.expression)) return;
    if (ts.isJsxElement(n) || ts.isJsxFragment(n) || ts.isJsxSelfClosingElement(n)) return element(n, ctx);
    if (ts.isJsxAttribute(n)) return attribute(n);
    // a key is not a text; the value is
    if (ts.isPropertyAssignment(n)) {
      const name = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : "";
      return visit(n.initializer, server && SERVER_PROPS.has(name) ? { kind: "error", relaxed: false } : ctx);
    }
    // a value that is compared with, or picks a case or a member, is a name
    if (ts.isBinaryExpression(n) && COMPARE.has(n.operatorToken.kind)) {
      for (const side of [n.left, n.right]) if (!isString(side)) visit(side, ctx);
      return;
    }
    if (ts.isCaseClause(n)) return n.statements.forEach((s) => visit(s, ctx));
    if (ts.isElementAccessExpression(n)) {
      visit(n.expression, ctx);
      if (!isString(n.argumentExpression)) visit(n.argumentExpression, ctx);
      return;
    }
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      const object = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : "";
      visit(callee, ctx);
      if (DENY_CALLS.has(name) || DENY_OBJECTS.has(object)) return;
      (n.arguments ?? []).forEach((a, i) => visit(a, server && SERVER_ERRORS.has(name) && i === (name === "UpstreamError" ? 1 : 0) ? { kind: "error", relaxed: false } : ctx));
      return;
    }
    if (isString(n) || ts.isTemplateExpression(n)) take(n, ctx);
    ts.forEachChild(n, (c) => visit(c, ctx));
  };

  visit(sf, { kind: undefined, relaxed: false });
  return rows;
}

/**
 * The texts of an HTML page: the text of each block, its title, alt, placeholder and aria-label, and its scripts.
 * @param {string} file @param {string} src
 * @returns {Row[]}
 */
function scanHtml(file, src, /** @type {ReadonlySet<string>} */ names) {
  /** @type {Row[]} */
  const rows = [];
  const lineAt = (/** @type {number} */ i) => src.slice(0, i).split("\n").length;
  for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const start = (m.index ?? 0) + m[0].indexOf(">") + 1;
    rows.push(...scanCode(file, parse(file, m[1] ?? "", true), names, lineAt(start) - 1));
  }
  // what is not text becomes blank lines, so the numbers of the lines stay
  const clean = src.replace(/<(script|style)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, (m) => m.replace(/[^\n]/g, " "));
  let piece = "";
  let start = -1;
  const flush = () => {
    const text = tidy(decode(piece));
    if (start >= 0 && worth(text)) rows.push({ file, line: lineAt(start), kind: "jsx", text });
    piece = "";
    start = -1;
  };
  for (const m of clean.matchAll(/<[^>]*>|[^<]+/g)) {
    const token = m[0];
    const at = m.index ?? 0;
    if (token.startsWith("<")) {
      const tag = /^<\/?\s*([a-z][a-z0-9-]*)/i.exec(token)?.[1]?.toLowerCase() ?? "";
      for (const a of token.matchAll(/\s(title|alt|placeholder|aria-label)="([^"]*)"/gi)) {
        const text = tidy(decode(a[2] ?? ""));
        if (worth(text)) rows.push({ file, line: lineAt(at + (a.index ?? 0)), kind: "attr", text });
      }
      if (tag === "br") piece += " ";
      else if (!INLINE.has(tag)) flush();
    } else {
      if (start < 0 && token.trim()) start = at + token.length - token.trimStart().length;
      piece += token;
    }
  }
  flush();
  return rows;
}

/** The files under `dir` that can hold a text: not tests, fixtures, declarations or a folder in `skip`. */
function listFiles(/** @type {string} */ root, /** @type {string} */ dir, /** @type {readonly string[]} */ skip) {
  /** @type {string[]} */
  const out = [];
  const go = (/** @type {string} */ rel) => {
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!/^(node_modules|dist|test|tests|fixtures|__tests__|\..*)$/.test(e.name) && !skip.includes(path)) go(path);
      } else if (/\.(tsx?|mjs|html)$/.test(e.name) && !/\.(test|spec)\.|\.d\.ts$/.test(e.name)) out.push(path);
    }
  };
  go(dir.replace(/^\.\//, "").replace(/\/+$/, ""));
  return out;
}

/**
 * Every text, sorted by file and line. `file` limits it to one file, `also` adds folders to the default ones.
 * @param {string} [root] @param {{ file?: string, also?: string[] }} [options]
 * @returns {Row[]}
 */
export function collect(root = ROOT, { file, also = [] } = {}) {
  /** @type {Set<string>} */
  const files = new Set();
  if (file) files.add(relative(root, resolve(root, file)).split("\\").join("/"));
  else {
    for (const a of AREAS) for (const f of listFiles(root, a.dir, a.skip)) files.add(f);
    for (const d of also) for (const f of listFiles(root, d, [])) files.add(f);
  }
  // the names of the code come from all the default folders, so one file reads the same alone as in the whole list
  /** @type {Map<string, ts.SourceFile>} */
  const trees = new Map();
  /** @type {Set<string>} */
  const names = new Set();
  const treeOf = (/** @type {string} */ f) => {
    let sf = trees.get(f);
    if (!sf) trees.set(f, (sf = parse(f, readFileSync(join(root, f), "utf8"))));
    return sf;
  };
  for (const a of AREAS) for (const f of listFiles(root, a.dir, [])) if (!f.endsWith(".html")) addNames(treeOf(f), names);
  /** @type {Row[]} */
  const rows = [];
  for (const f of files) rows.push(...(f.endsWith(".html") ? scanHtml(f, readFileSync(join(root, f), "utf8"), names) : scanCode(f, treeOf(f), names)));
  rows.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  return rows.filter((r, i) => { const p = rows[i - 1]; return !p || p.file !== r.file || p.line !== r.line || p.kind !== r.kind || p.text !== r.text; });
}

/** The output lines: `file:line<TAB>kind<TAB>text`. */
export const lines = (/** @type {Row[]} */ rows) => rows.map((r) => `${r.file}:${r.line}\t${r.kind}\t${r.text}`);

/** The number of texts per file: `file<TAB>number`. */
export function counts(/** @type {Row[]} */ rows) {
  /** @type {Map<string, number>} */
  const n = new Map();
  for (const r of rows) n.set(r.file, (n.get(r.file) ?? 0) + 1);
  return [...n].map(([f, c]) => `${f}\t${c}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  /** @type {{ file?: string, also: string[] }} */
  const options = { also: [] };
  let count = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--count") count = true;
    else if ((a === "--file" || a === "--also") && args[i + 1]) {
      if (a === "--file") options.file = args[++i];
      else options.also.push(/** @type {string} */ (args[++i]));
    } else {
      console.error("usage: pnpm strings [--file <path>] [--count] [--also <dir>]");
      process.exit(2);
    }
  }
  const rows = collect(ROOT, options);
  process.stdout.on("error", () => process.exit(0));
  const out = count ? counts(rows) : lines(rows);
  if (out.length) console.log(out.join("\n"));
}
