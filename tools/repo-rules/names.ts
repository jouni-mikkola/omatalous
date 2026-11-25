/**
 * The detector behind rule 50 (names-rules.ts): a control written in JSX that a screen reader cannot name. Pure: a
 * parsed file in, the lines out, so the rule and its test share it.
 *
 * A button, link or summary needs a text child, an expression child (its value is the name) or an `aria-label`,
 * `aria-labelledby` or `title`. A field (input, select, textarea) needs a label around it, an `aria-label`,
 * `aria-labelledby`, `title` or an `id` for a label elsewhere. A component that spreads its props may carry the name in
 * them, so it is left alone, and so is a field that is hidden.
 */
import ts from "typescript6";

export interface Unnamed {
  line: number;
  tag: string;
}

const FIELDS = new Set(["input", "select", "textarea"]);
const CLICKABLE = new Set(["button", "a", "summary"]);

const attrsOf = (el: ts.JsxOpeningLikeElement) => el.attributes.properties;
const hasAttr = (el: ts.JsxOpeningLikeElement, ...names: string[]) => attrsOf(el).some((a) => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && names.includes(a.name.text));
const spreads = (el: ts.JsxOpeningLikeElement) => attrsOf(el).some((a) => ts.isJsxSpreadAttribute(a));
function stringAttr(el: ts.JsxOpeningLikeElement, name: string): string | undefined {
  for (const a of attrsOf(el)) {
    if (ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === name && a.initializer && ts.isStringLiteral(a.initializer)) return a.initializer.text;
  }
  return undefined;
}

/** True when what is inside the element says something: a word, or an expression that may be one. */
function hasContent(children: readonly ts.JsxChild[], sf: ts.SourceFile): boolean {
  return children.some((c) => {
    if (ts.isJsxText(c)) return c.text.trim() !== "";
    if (ts.isJsxExpression(c)) return c.expression !== undefined;
    if (ts.isJsxElement(c)) {
      if (hasAttr(c.openingElement, "aria-hidden")) return false;
      return hasContent(c.children, sf);
    }
    // a self-closing component may draw its own words; a self-closing html tag (an icon, an image) draws none
    if (ts.isJsxSelfClosingElement(c)) return /^[A-Z]/.test(c.tagName.getText(sf)) && !hasAttr(c, "aria-hidden");
    return ts.isJsxFragment(c) && hasContent(c.children, sf);
  });
}

/** The controls in a file with no name, as the line of the tag. */
export function unnamedControls(sf: ts.SourceFile): Unnamed[] {
  const found: Unnamed[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: ts.Node, inLabel: boolean): void => {
    let labelled = inLabel;
    let opening: ts.JsxOpeningLikeElement | undefined;
    let children: readonly ts.JsxChild[] = [];
    if (ts.isJsxElement(node)) {
      opening = node.openingElement;
      children = node.children;
    } else if (ts.isJsxSelfClosingElement(node)) opening = node;
    if (opening) {
      const tag = opening.tagName.getText(sf);
      if (tag === "label") labelled = true;
      const named = hasAttr(opening, "aria-label", "aria-labelledby", "title") || spreads(opening);
      if (!named && CLICKABLE.has(tag) && !hasContent(children, sf)) found.push({ line: line(opening), tag });
      if (!named && FIELDS.has(tag) && !labelled && !hasAttr(opening, "id", "hidden") && stringAttr(opening, "type") !== "hidden") found.push({ line: line(opening), tag });
    }
    ts.forEachChild(node, (c) => visit(c, labelled));
  };
  visit(sf, false);
  return found;
}
