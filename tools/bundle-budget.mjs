/**
 * The entry budget: what the browser loads before the first page (the files `index.html` names: the module script, its
 * preloads and the stylesheets), each gzipped at level 9 and added up, against `apps/web/bundle-budget.json`. The size
 * may grow to `maxGrowth` over the size at the time the budget was set. A bigger entry is fixed (route splitting, a
 * lighter import), not given room: the file is changed only by the decision that sets a new base, with the measurement
 * in the pull request.
 *
 * The second budget is the script of Yhteenveto, the first page: the entry's modules, the chunk of the page, the Finnish
 * texts of the pages that `ensureLate` fetches at once, and every module any of them imports statically, in bytes
 * before gzip (the figure of the Network panel's "Resources"). A lazy part (the toolbar of a table, the renderer of
 * cells made of components) is not in it, since the page does not fetch it. It may grow to `firstPageMaxGrowth` (5 %,
 * so the limit stays under two thirds of the size before BA-126) over `firstPageScriptBytes`.
 *   node tools/bundle-budget.mjs [dist folder]    (pnpm budgets runs it after the build)
 */
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The files of the entry, as `index.html` of `dist` names them (paths from the folder), in the order they appear. */
export function entryFiles(html) {
  const files = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const rel = /\brel="([^"]*)"/.exec(tag)?.[1];
    if (tag.startsWith("<link") && rel !== "modulepreload" && rel !== "stylesheet") continue;
    const ref = /\b(?:src|href)="([^"]*)"/.exec(tag)?.[1];
    if (ref?.startsWith("/")) files.push(ref.slice(1));
  }
  return files;
}

/** The gzip size of the entry of a built folder: the total and each file. */
export function entrySize(dist) {
  const parts = entryFiles(readFileSync(join(dist, "index.html"), "utf8")).map((file) => ({ file, bytes: gzipSync(readFileSync(join(dist, file)), { level: 9 }).length }));
  return { total: parts.reduce((n, p) => n + p.bytes, 0), parts };
}

/** The static imports of a module's source: `from"./x.js"` and `import"./x.js"`, not `import("./x.js")`, which loads later. */
export function staticImports(source) {
  return [...source.matchAll(/(?:\bfrom|\bimport)\s*["']\.\/([^"']+\.js)["']/g)].map((m) => m[1]);
}

/** The script of the first page: the files it loads (path from `assets/`), each with its size before gzip and after, and both totals. */
export function firstPageScript(dist, { page = "OverviewView", texts = "messages-late" } = {}) {
  const assets = join(dist, "assets");
  const names = readdirSync(assets);
  const named = (prefix) => names.find((f) => f.startsWith(`${prefix}-`) && f.endsWith(".js"));
  const roots = [...entryFiles(readFileSync(join(dist, "index.html"), "utf8")).filter((f) => f.endsWith(".js")).map((f) => f.replace(/^assets\//, "")), named(page), named(texts)];
  if (roots.includes(undefined)) throw new Error(`bundle budget: no chunk named ${page} or ${texts} in ${assets}`);
  const seen = new Map();
  const visit = (file) => {
    if (seen.has(file)) return;
    const body = readFileSync(join(assets, file));
    seen.set(file, { file, raw: body.length, gzip: gzipSync(body, { level: 9 }).length });
    for (const next of staticImports(body.toString("utf8"))) visit(next);
  };
  roots.forEach(visit);
  const parts = [...seen.values()];
  return { raw: parts.reduce((n, p) => n + p.raw, 0), gzip: parts.reduce((n, p) => n + p.gzip, 0), parts };
}

/** The verdict on a size: the limit, and whether the size is within it. */
export function judge(total, budget) {
  const limit = Math.floor(budget.entryGzipBytes * (1 + budget.maxGrowth));
  return { limit, ok: total <= limit };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] ?? join(root, "apps/web/dist");
  const budget = JSON.parse(readFileSync(join(root, "apps/web/bundle-budget.json"), "utf8"));
  const { total, parts } = entrySize(dist);
  const { limit, ok } = judge(total, budget);
  for (const p of parts) console.log(`${String(p.bytes).padStart(8)}  ${p.file}`);
  console.log(`entry ${total} B gzip, base ${budget.entryGzipBytes} B, limit ${limit} B (+${budget.maxGrowth * 100} %)`);
  const first = firstPageScript(dist);
  const firstLimit = Math.floor(budget.firstPageScriptBytes * (1 + budget.firstPageMaxGrowth));
  for (const p of [...first.parts].sort((a, b) => b.raw - a.raw).slice(0, 8)) console.log(`${String(p.raw).padStart(8)}  ${p.file}`);
  console.log(`first page ${first.raw} B script (${first.gzip} B gzip), base ${budget.firstPageScriptBytes} B, limit ${firstLimit} B (+${budget.firstPageMaxGrowth * 100} %)`);
  if (first.raw > firstLimit) {
    console.error(`bundle budget: the script of Yhteenveto is ${first.raw - firstLimit} B over its limit. Load the heavy part when it is used (lazy import); the base is not raised to fit.`);
    process.exit(1);
  }
  if (!ok) {
    console.error(`bundle budget: the entry is ${total - limit} B over its limit. Split the route or lighten the import; the base is not raised to fit.`);
    process.exit(1);
  }
}
