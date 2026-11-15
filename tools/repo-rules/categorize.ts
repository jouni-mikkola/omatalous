/**
 * The detector behind rule 51 (code-rules.ts): a way to reach `categorize`, the rule table itself, that skips
 * `categorizeInDirection`. Pure: a parsed file in, the lines out, so the rule and its test share it.
 *
 * Found: a call or a read of `x.categorize` and `x["categorize"]`, a call of a bare `categorize`, an import, a
 * re-export (`export { categorize as run } from ...`) or a destructuring of the name (under any alias), and a namespace import of core (`import * as core from "@banking/core"`)
 * that is used as a whole, since the object carries `categorize` to whoever receives it. A whole use is allowed only as
 * the argument of `moduleApiOf`, which returns core with `categorize` reading by direction.
 *
 * The tree has no parent pointers (`parse` in lib.ts), so the walk passes the parent down.
 */
import ts from "typescript6";
import { lineOf } from "./lib.ts";

export interface DirectUse {
  line: number;
  why: string;
}

const NAME = "categorize";
const SAFE_DOOR = "moduleApiOf";
const isName = (n: ts.Node | undefined): boolean => n !== undefined && ts.isIdentifier(n) && n.text === NAME;
const isCore = (spec: string): boolean => spec === "@banking/core" || /(^|\/)categorize\.ts$/.test(spec);

/** True when `call` is `moduleApiOf(...)` or `x.moduleApiOf(...)`. */
function isSafeDoor(call: ts.CallExpression): boolean {
  const f = call.expression;
  return (ts.isIdentifier(f) && f.text === SAFE_DOOR) || (ts.isPropertyAccessExpression(f) && f.name.text === SAFE_DOOR);
}

export function directCategorizeUses(sf: ts.SourceFile): DirectUse[] {
  const found: DirectUse[] = [];
  const add = (n: ts.Node, why: string) => found.push({ line: lineOf(sf, n), why });
  const namespaces = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !isCore(st.moduleSpecifier.text)) continue;
    const bindings = st.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  }
  const visit = (n: ts.Node, parent: ts.Node | undefined): void => {
    if (ts.isImportSpecifier(n) && isName(n.propertyName ?? n.name)) add(n, "imports categorize directly");
    else if (ts.isExportSpecifier(n) && isName(n.propertyName ?? n.name)) add(n, "re-exports categorize");
    else if (ts.isBindingElement(n) && isName(n.propertyName ?? n.name)) add(n, "takes categorize out of an object");
    else if (ts.isCallExpression(n) && isName(n.expression)) add(n, "calls categorize directly");
    else if (ts.isPropertyAccessExpression(n) && isName(n.name)) add(n, "reaches categorize through a property");
    else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === NAME) add(n, "reaches categorize through a property");
    else if (ts.isIdentifier(n) && namespaces.has(n.text) && parent) {
      // `core.x`, `core["x"]`, a type name `core.X`, the import itself and `typeof core` name one member or none
      const member = ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === n) || ts.isQualifiedName(parent) || ts.isNamespaceImport(parent) || ts.isTypeQueryNode(parent);
      const door = ts.isCallExpression(parent) && parent.arguments.includes(n as ts.Expression) && isSafeDoor(parent);
      if (!member && !door) add(n, `hands out the whole of ${n.text}, which holds categorize: pass it through ${SAFE_DOOR}`);
    }
    ts.forEachChild(n, (child) => visit(child, n));
  };
  visit(sf, undefined);
  return found;
}
