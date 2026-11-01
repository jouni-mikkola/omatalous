/**
 * The detector behind rule 40 (css-tokens.ts): what in the web app's stylesheets and scripts sets a part of the look
 * by hand when a token exists for it. Pure: text in, hits out, so the rule and its test share it and nothing here
 * reads the tree.
 *
 * Counted in a stylesheet, in a declaration's value:
 *   px        a length in px other than 0 and 1px (a hairline)
 *   color     a hex colour or a colour function (rgb, hsl, oklch, lab, lch, hwb)
 *   fontSize  a font-size that is not a --fs-* token, inherit, initial or unset
 *   duration  a time other than 0 (150ms, 0.15s) in a transition or animation: read a --t-* token
 *   redefined a token of tokens.css set again under its own name
 * Counted in a script:
 *   tsColor     a string that is a hex colour, or holds a colour function
 *   inlineLook  a look value (colour, font, radius, shadow, space) in a JSX `style={{ ... }}`
 *   setProperty a call of `setProperty`, which sets a custom property from script
 * Media and container queries are not counted: a query has no variable to read.
 */
import ts from "typescript6";

export type Metric = "px" | "color" | "fontSize" | "duration" | "redefined" | "tsColor" | "inlineLook" | "setProperty";
export interface Hit {
  line: number;
  metric: Metric;
  text: string;
}

/** The rules of the drawn card face, the one named exception: a card's own colours, not the app's. */
export const NAMED_EXCEPTIONS: readonly { file: string; selector: RegExp; why: string }[] = [
  { file: "apps/web/src/styles/holdings.css", selector: /\.card-face\b/, why: "the drawn face of a bank card has colours of its own (card-face.test.ts)" },
];

const COLOR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const PX = /(?<![\w#.-])(\d*\.\d+|\d+)px\b/g;
const TIME = /(?<![\w#.-])(?:\d*\.\d+|\d+)m?s\b/g;
const MOTION_PROP = /^(?:transition|animation)(?:-delay|-duration)?$/;
const FONT_SIZE_OK = /^(?:var\(--fs-|inherit\b|initial\b|unset\b)/;

/** The text with comments blanked, newlines kept so a line number is still right. */
const blank = (s: string, re: RegExp) => s.replace(re, (m) => m.replace(/[^\n]/g, " "));

/** Custom properties a stylesheet defines, as `--name`. */
export function definedProperties(css: string): Set<string> {
  return new Set([...blank(css, /\/\*[\s\S]*?\*\//g).matchAll(/(?<![\w-])(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
}

export function cssHits(file: string, css: string, tokens: ReadonlySet<string>): Hit[] {
  const hits: Hit[] = [];
  const text = blank(blank(css, /\/\*[\s\S]*?\*\//g), /url\([^)]*\)/g);
  const lineAt = (i: number) => text.slice(0, i).split("\n").length;
  for (const rule of text.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
    const selector = rule[1]!.trim();
    if (NAMED_EXCEPTIONS.some((e) => e.file === file && e.selector.test(selector))) continue;
    let offset = rule.index! + rule[1]!.length + 1;
    for (const decl of rule[2]!.split(";")) {
      const at = offset;
      offset += decl.length + 1;
      const colon = decl.indexOf(":");
      if (colon < 0) continue;
      const prop = decl.slice(0, colon).trim();
      const value = decl.slice(colon + 1).trim();
      const line = lineAt(at + decl.search(/\S|$/));
      const hit = (metric: Metric, t: string) => hits.push({ line, metric, text: `${prop}: ${t}`.slice(0, 80) });
      if (prop.startsWith("--") && tokens.has(prop) && !file.endsWith("/tokens.css")) hit("redefined", value);
      for (const m of value.matchAll(PX)) if (Number(m[1]) > 1) hit("px", value);
      if (HEX.test(value) || COLOR_FN.test(value)) hit("color", value);
      if (MOTION_PROP.test(prop)) for (const m of value.matchAll(TIME)) if (parseFloat(m[0]) > 0) hit("duration", value);
      if (prop === "font-size" && !FONT_SIZE_OK.test(value)) hit("fontSize", value);
    }
  }
  return hits;
}

/** The style properties that carry the look. A value computed from data (a width in %) is not one. */
const LOOK_PROPS = new Set([
  "color", "background", "backgroundColor", "borderColor", "border", "borderRadius", "boxShadow", "outline", "stroke", "fill",
  "fontSize", "fontFamily", "fontWeight", "lineHeight", "letterSpacing",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "gap",
]);

export function tsHits(source: string): Hit[] {
  const sf = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: Hit[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node): void => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && (/^#[0-9a-fA-F]{3,8}$/.test(n.text) || COLOR_FN.test(n.text))) {
      hits.push({ line: lineOf(n), metric: "tsColor", text: n.text.slice(0, 60) });
    }
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === "style" && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) {
      const e = n.initializer.expression;
      if (ts.isObjectLiteralExpression(e)) {
        for (const p of e.properties) {
          const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : "";
          if (LOOK_PROPS.has(name)) hits.push({ line: lineOf(p), metric: "inlineLook", text: p.getText(sf).slice(0, 60) });
        }
      }
    }
    // css({ margin: 0 }) of css.ts is the style attribute's successor: a look value written as a literal there is the same fault
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "css" && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
      for (const p of n.arguments[0].properties) {
        if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
        const camel = p.name.text.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        const literal = ts.isStringLiteralLike(p.initializer) || ts.isNumericLiteral(p.initializer);
        if (literal && LOOK_PROPS.has(camel)) hits.push({ line: lineOf(p), metric: "inlineLook", text: p.getText(sf).slice(0, 60) });
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "setProperty") {
      hits.push({ line: lineOf(n), metric: "setProperty", text: n.getText(sf).slice(0, 60) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

/** The hits of a file as a count per metric; a metric with none is left out. */
export function counts(hits: readonly Hit[]): Partial<Record<Metric, number>> {
  const out: Partial<Record<Metric, number>> = {};
  for (const h of hits) out[h.metric] = (out[h.metric] ?? 0) + 1;
  return out;
}

/**
 * Own class selectors (`.name {`, alone or in a list) styled in more than one stylesheet, as class -> files. A page's
 * stylesheet stays loaded after the page is left, so the second one changes the first one's page. Text in, files out.
 */
export function sharedClasses(sheets: ReadonlyMap<string, string>): Map<string, string[]> {
  const where = new Map<string, Set<string>>();
  for (const [file, css] of sheets) {
    for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{};]*)\{/g)) {
      for (const part of rule[1]!.split(",")) {
        const m = /^\.([\w-]+)$/.exec(part.trim());
        if (m) where.set(m[1]!, (where.get(m[1]!) ?? new Set()).add(file));
      }
    }
  }
  return new Map([...where].filter(([, files]) => files.size > 1).map(([name, files]) => [name, [...files].sort()]));
}
