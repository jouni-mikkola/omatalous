/**
 * Rule 6 of the repo rules: which folder may import which, as data.
 *
 * The layers are the ones docs/ARCHITECTURE.md and .claude/plan/research/G-structure.md (section 5.5) describe:
 * core knows nothing outside itself, db sits below services, services below routes, and the web app never reaches
 * into the server. Imports that already break a rule are listed in BASELINE. The list can only shrink:
 *   - a violation that is not in it fails (new coupling),
 *   - an entry that no longer occurs fails (so the list cannot rot, and a fixed violation cannot come back).
 */
import { dirname, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { type Finding, expectNoFindings, importsOf, lineIn, repoFiles, sourceFiles, specifiersOf } from "./lib.ts";

const SELF = "tools/repo-rules/boundaries.ts";

interface Rule {
  id: string;
  /** One line: why the import is not allowed. */
  why: string;
  /** Importing file, as a path from the repo root. */
  from: RegExp;
  /** What it imports: a path from the repo root, or `ext:<specifier>` for a package or a Node module. */
  deny: RegExp;
}

const SERVER = "apps/server/src";
const CORE = "packages/core/src";

const RULES: Rule[] = [
  {
    id: "core-is-self-contained",
    why: "core runs in the browser and on the server, so it imports only core files (no package, no node:)",
    from: new RegExp(`^${CORE}/`),
    deny: new RegExp(`^(?!${CORE}/)`),
  },
  {
    id: "core-does-not-import-sources",
    why: "core domain code receives a source's dialect as an argument; only the server looks a parser up in sources/registry.ts",
    from: new RegExp(`^${CORE}/(?!sources/|index\\.ts$)`),
    deny: new RegExp(`^${CORE}/sources/`),
  },
  {
    id: "analysis-is-below-reports",
    why: "reports are built on analysis, so analysis must not import them back (a cycle between folders)",
    from: new RegExp(`^${CORE}/analysis/`),
    deny: new RegExp(`^${CORE}/reports/`),
  },
  {
    id: "reports-are-independent",
    why: "a report is a pure function of the context; shared code goes in reports/shared.ts or analysis/",
    from: new RegExp(`^${CORE}/reports/(?!index\\.ts$)`),
    deny: new RegExp(`^${CORE}/reports/(?!shared\\.ts$)`),
  },
  {
    id: "db-is-below-services",
    why: "db/ holds all SQL and sits at the bottom of the server; it must not reach up",
    from: new RegExp(`^${SERVER}/db/`),
    deny: new RegExp(`^${SERVER}/(services|routes|auth|connectors)/`),
  },
  {
    id: "security-is-below-providers",
    why: "security/ is generic (keys, limits, sealing) and must not depend on one bank, connector or lookup provider",
    from: new RegExp(`^${SERVER}/security/`),
    deny: new RegExp(`^${SERVER}/(providers|connectors)/`),
  },
  {
    id: "finance-modules-behind-facade",
    why: "the modules of db/finance/ are reached through the FinanceRepo facade, the one way to financial rows",
    from: new RegExp(`^${SERVER}/(?!db/finance-repo\\.ts$|db/finance/)`),
    deny: new RegExp(`^${SERVER}/db/finance/`),
  },
  {
    id: "providers-are-leaves",
    why: "providers and a connector's API client talk to the outside world and return data; they must not know services, db or routes",
    from: new RegExp(`^${SERVER}/(providers/|connectors/[^/]+/(client|jwt|mapper|types)\\.ts$)`),
    deny: new RegExp(`^${SERVER}/(services|db|routes)/`),
  },
  {
    id: "services-do-not-import-routes",
    why: "routes call services and connectors, never the other way round",
    from: new RegExp(`^${SERVER}/(services|connectors)/`),
    deny: new RegExp(`^${SERVER}/routes/`),
  },
  {
    id: "routes-use-services",
    why: "a route validates and calls a service; SQL and provider calls belong behind a service",
    from: new RegExp(`^${SERVER}/routes/`),
    deny: new RegExp(`^${SERVER}/(db/|providers/|connectors/[^/]+/(client|jwt|mapper)\\.ts$)`),
  },
  {
    id: "server-has-no-web",
    why: "the server is shipped without the web app's source",
    from: new RegExp(`^${SERVER}/`),
    deny: /^(apps\/web\/|ext:@banking\/web)/,
  },
  {
    id: "web-has-no-server",
    why: "the browser bundle must not pull in server code; share through @banking/core",
    from: /^apps\/web\/src\//,
    deny: /^(apps\/server\/|ext:@banking\/server)/,
  },
  {
    id: "web-runs-in-a-browser",
    why: "nothing in the web app can use a Node module",
    from: /^apps\/web\/src\//,
    deny: /^ext:node:/,
  },
  {
    id: "charts-and-components-are-below-pages",
    why: "pages compose charts and components; the reverse makes a cycle",
    from: /^apps\/web\/src\/(charts|components)\//,
    deny: /^apps\/web\/src\/pages\//,
  },
];

/**
 * Imports that break a rule today, as `<rule id>  <importing file> -> <imported file>`. Fix one, then delete its line.
 * Do not add to it: a new violation is a design problem to solve in the change that introduces it.
 */
const BASELINE: string[] = [
  // BalanceInput (a type) and yearEarlier (a date helper) are shared between reports; both belong in reports/shared.ts
  "reports-are-independent  packages/core/src/reports/buffer.ts -> packages/core/src/reports/balances.ts",
  "reports-are-independent  packages/core/src/reports/price-changes.ts -> packages/core/src/reports/summary.ts",
  // type-only imports of row and repo types; the services should re-export or return their own types
  "routes-use-services  apps/server/src/routes/finance.ts -> apps/server/src/db/rows.ts",
  "routes-use-services  apps/server/src/routes/merchants.ts -> apps/server/src/db/finance-repo.ts",
  "routes-use-services  apps/server/src/routes/users.ts -> apps/server/src/db/rows.ts",
];

interface Edge {
  rule: Rule;
  from: string;
  to: string;
  line: number;
  typeOnly: boolean;
}

/** Where an import points: a repo path for our files, `ext:<specifier>` for a package or a Node module. */
function target(from: string, spec: string, known: ReadonlySet<string>): string {
  const find = (base: string): string | undefined => {
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base.replace(/\.(m?js)$/, ".ts"), base.replace(/\.js$/, ".tsx")];
    return candidates.find((c) => known.has(c));
  };
  if (spec.startsWith(".")) {
    const base = posix.normalize(posix.join(dirname(from), spec));
    return find(base) ?? base;
  }
  // workspace packages resolve to their source, as the bundlers and tsconfig do
  const ws = /^@banking\/core(?:\/(.+))?$/.exec(spec);
  if (ws) return (ws[1] ? find(`${CORE}/${ws[1]}`) : find(`${CORE}/index`)) ?? `ext:${spec}`;
  return `ext:${spec}`;
}

function edges(): { all: Edge[]; matched: Map<string, number> } {
  const known = new Set(repoFiles());
  const matched = new Map(RULES.map((r) => [r.id, 0]));
  const all: Edge[] = [];
  for (const file of sourceFiles("packages/core/src/", "apps/server/src/", "apps/web/src/")) {
    const rules = RULES.filter((r) => r.from.test(file));
    if (rules.length === 0) continue;
    for (const r of rules) matched.set(r.id, matched.get(r.id)! + 1);
    // the token scanner finds the specifiers; the syntax tree is built only for a file that breaks a rule, to name the line
    const hits = [...new Set(specifiersOf(file))].flatMap((spec) => {
      const to = target(file, spec, known);
      return rules.filter((rule) => rule.deny.test(to)).map((rule) => ({ spec, to, rule }));
    });
    if (hits.length === 0) continue;
    const refs = importsOf(file);
    for (const h of hits) {
      const ref = refs.find((r) => r.spec === h.spec);
      all.push({ rule: h.rule, from: file, to: h.to, line: ref?.line ?? 1, typeOnly: ref?.typeOnly ?? false });
    }
  }
  return { all, matched };
}

const keyOf = (e: Edge) => `${e.rule.id}  ${e.from} -> ${e.to}`;

let scanned: ReturnType<typeof edges> | undefined;
const scan = () => (scanned ??= edges());

describe("repo rules: import boundaries (rule 6)", () => {
  it("rule 6a: every import respects the folder layers, except the baseline", () => {
    const { all } = scan();
    const base = new Set(BASELINE);
    const found: Finding[] = all
      .filter((e) => !base.has(keyOf(e)))
      .map((e) => ({ file: e.from, line: e.line, why: `${e.typeOnly ? "type import" : "import"} of ${e.to} breaks "${e.rule.id}": ${e.rule.why}` }));
    expectNoFindings("import boundaries", found, "import from the layer below instead, or move the shared piece down to a folder both may import. Do not add the edge to BASELINE in tools/repo-rules/boundaries.ts.");
  });

  it("rule 6b: every baseline entry still occurs, so the list shrinks when a violation is fixed", () => {
    const live = new Set(scan().all.map(keyOf));
    const found: Finding[] = BASELINE.filter((b) => !live.has(b)).map((b) => ({ file: SELF, line: lineIn(SELF, b), why: `baseline entry no longer occurs, delete it: ${b}` }));
    expectNoFindings("import boundary baseline", found, "remove the listed lines from BASELINE in tools/repo-rules/boundaries.ts. Good: the violation is gone.");
  });

  it("rule 6c: every boundary rule still applies to at least one file", () => {
    const { matched } = scan();
    const found: Finding[] = RULES.filter((r) => (matched.get(r.id) ?? 0) === 0).map((r) => ({ file: SELF, line: lineIn(SELF, `id: "${r.id}"`), why: `rule "${r.id}" matches no file: its folder moved or was renamed` }));
    expectNoFindings("import boundary rules", found, "update the `from` pattern of the rule to the folder's new path, or delete the rule if the layer is gone.");
    expect(new Set(RULES.map((r) => r.id)).size, "rule ids are unique").toBe(RULES.length);
  });
});
