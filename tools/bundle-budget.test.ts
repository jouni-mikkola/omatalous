import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "./lib/tmp-kit.ts";
import { entryFiles, entrySize, firstPageScript, judge, staticImports } from "./bundle-budget.mjs";

const HTML = `<script type="module" crossorigin src="/assets/index-A.js"></script>
<link rel="modulepreload" crossorigin href="/assets/hooks-B.js">
<link rel="stylesheet" crossorigin href="/assets/index-C.css">
<link rel="icon" href="/favicon.svg"><link rel="manifest" href="/manifest.webmanifest">`;

describe("the entry budget", () => {
  it("names the files the page loads before its first route, not the icon or the manifest", () => {
    expect(entryFiles(HTML)).toEqual(["assets/index-A.js", "assets/hooks-B.js", "assets/index-C.css"]);
  });

  it("adds up the gzip size of each file, and a lazy chunk is not in it", () => {
    const dist = tempDir("budget-");
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), HTML);
    for (const f of ["index-A.js", "hooks-B.js", "index-C.css", "Lazy-D.js"]) writeFileSync(join(dist, "assets", f), "x".repeat(5000));
    const { total, parts } = entrySize(dist);
    expect(parts.map((p) => p.file)).toEqual(["assets/index-A.js", "assets/hooks-B.js", "assets/index-C.css"]);
    expect(total).toBe(parts.reduce((n, p) => n + p.bytes, 0));
    expect(total).toBeLessThan(200);
  });

  it("reads static imports and not the lazy ones", () => {
    expect(staticImports(`import{o as e}from"./runtime-A.js";import"./side-B.js";const x=()=>import("./Lazy-C.js");export{e}`)).toEqual(["runtime-A.js", "side-B.js"]);
  });

  it("adds up the first page: the entry, its page chunk, the texts and what they import, once each", () => {
    const dist = tempDir("budget-first-");
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), HTML);
    const files = {
      "index-A.js": 'import"./hooks-B.js";const l=()=>import("./messages-late-L.js");',
      "hooks-B.js": "export const a=1;",
      "OverviewView-V.js": 'import{a}from"./Shared-S.js";import"./hooks-B.js";const t=()=>import("./Toolbar-T.js");',
      "Shared-S.js": "export const s=1;",
      "messages-late-L.js": 'import"./hooks-B.js";',
      "Toolbar-T.js": "export const t=1;",
    };
    for (const [f, body] of Object.entries(files)) writeFileSync(join(dist, "assets", f), body);
    writeFileSync(join(dist, "assets", "index-C.css"), "x");
    const { raw, parts } = firstPageScript(dist);
    expect(parts.map((p) => p.file).sort()).toEqual(["OverviewView-V.js", "Shared-S.js", "hooks-B.js", "index-A.js", "messages-late-L.js"]);
    expect(raw).toBe(parts.reduce((n, p) => n + p.raw, 0));
  });

  it("allows a tenth over the base and not a byte more", () => {
    const budget = { entryGzipBytes: 1000, maxGrowth: 0.1 };
    expect(judge(1100, budget)).toEqual({ limit: 1100, ok: true });
    expect(judge(1101, budget).ok).toBe(false);
  });

  it("holds the real file: a base set once, ten percent of room", () => {
    const budget = JSON.parse(readFileSync(new URL("../apps/web/bundle-budget.json", import.meta.url), "utf8"));
    expect(budget.maxGrowth).toBe(0.1);
    // the base is a decision: a new one is a change of this line too, with the measurement in the pull request
    expect(budget.entryGzipBytes).toBe(158186);
    // BA-126: 1 253 854 B before, 769 175 B after (61 %); the script of Yhteenveto without the toolbar of a table and the renderer of cells made of components
    expect(budget.firstPageScriptBytes).toBe(769175);
    // the limit stays under two thirds of the 1 253 854 B before
    expect(Math.floor(budget.firstPageScriptBytes * (1 + budget.firstPageMaxGrowth))).toBeLessThan((1253854 * 2) / 3);
  });
});
