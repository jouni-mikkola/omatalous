/**
 * The detector behind rule 51 (code-rules.ts): a way to reach `categorize`, the rule table itself, that skips
 * `categorizeInDirection`. Pure: a parsed file in, the lines out, so the rule and its test share it.
 *
 * Found: a call or a read of `x.categorize` and `x["categorize"]`, a call of a bare `categorize`, an import or a
 * destructuring of the name (under any alias), and a namespace import of core (`import * as core from "@banking/core"`)
 * that is used as a whole, since the object carries `categorize` to whoever receives it. A whole use is allowed only as
 * `{ ...core, categorize: ... }`, which replaces the name in the same object.
 */
import ts from "typescript6";
import { lineOf, walk } from "./lib.ts";

export interface DirectUse {
  line: number;
  why: string;
}

const NAME = "categorize";
const isName = (n: ts.Node | undefined): boolean => n !== undefined && ts.isIdentifier(n) && n.text === NAME;
const isCore = (spec: string): boolean => spec === "@banking/core" || /(^|\/)categorize\.ts$/.test(spec);

/** True when `use` is `...ns` inside an object literal that sets `categorize` itself after the spread, so the spread's own is replaced. */
function spreadWithOverride(use: ts.Identifier): boolean {
  const spread = use.parent;
  if (!ts.isSpreadAssignment(spread) || !ts.isObjectLiteralExpression(spread.parent)) return false;
  const props = spread.parent.properties;
  return props.slice(props.indexOf(spread) + 1).some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && isName(p.name));
}

export function directCategorizeUses(sf: ts.SourceFile): DirectUse[] {
  const found: DirectUse[] = [];
  const add = (n: ts.Node, why: string) => found.push({ line: lineOf(sf, n), why });
  const namespaces = new Set<string>();
  walk(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && isCore(n.moduleSpecifier.text)) {
      const bindings = n.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    }
  });
  walk(sf, (n) => {
    if (ts.isImportSpecifier(n) && isName(n.propertyName ?? n.name)) add(n, "imports categorize directly");
    else if (ts.isBindingElement(n) && isName(n.propertyName ?? n.name)) add(n, "takes categorize out of an object");
    else if (ts.isCallExpression(n) && isName(n.expression)) add(n, "calls categorize directly");
    else if (ts.isPropertyAccessExpression(n) && isName(n.name)) add(n, "reaches categorize through a property");
    else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === NAME) add(n, "reaches categorize through a property");
    else if (ts.isIdentifier(n) && namespaces.has(n.text)) {
      const p = n.parent;
      // `core.x`, `core["x"]` and a type name `core.X` name one member; the import itself and `typeof core` are no use
      const member = (ts.isPropertyAccessExpression(p) && p.expression === n) || (ts.isElementAccessExpression(p) && p.expression === n) || ts.isQualifiedName(p) || ts.isNamespaceImport(p) || ts.isTypeQueryNode(p);
      if (!member && !spreadWithOverride(n)) add(n, `hands out the whole of ${n.text}, which holds categorize: spread it with categorize replaced by categorizeInDirection`);
    }
  });
  return found;
}
