import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { collect, render } from "./third-party-notices.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "notices-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const FILES: Record<string, object | string> = {
  "apps/a/package.json": { name: "@x/a", dependencies: { lib: "1", core: "1" }, devDependencies: { dev: "1" } },
  "apps/a/node_modules/lib/package.json": { name: "lib", version: "1.2.0", license: "MIT", dependencies: { inner: "1" } },
  "apps/a/node_modules/lib/LICENSE": "MIT text of lib\n",
  "apps/a/node_modules/inner/package.json": { name: "inner", version: "0.1.0", license: "ISC" },
  "apps/a/node_modules/core/package.json": { name: "core", version: "1.0.0", private: true },
  "apps/a/node_modules/dev/package.json": { name: "dev", version: "1.0.0", license: "GPL-3.0" },
};
for (const [f, v] of Object.entries(FILES)) {
  mkdirSync(join(dir, dirname(f)), { recursive: true });
  writeFileSync(join(dir, f), typeof v === "string" ? v : JSON.stringify(v));
}

describe("third-party notices", () => {
  it("lists runtime dependencies and theirs, not dev dependencies or our own packages", () => {
    const names = collect(dir, ["apps/a"]).map((p) => `${p.name}@${p.version} ${p.license}`);
    expect(names).toEqual(["inner@0.1.0 ISC", "lib@1.2.0 MIT"]);
  });

  it("carries the licence text a package ships and says so when it ships none", () => {
    const text = render(collect(dir, ["apps/a"]));
    expect(text).toContain("lib 1.2.0 (MIT)");
    expect(text).toContain("MIT text of lib");
    expect(text).toContain("inner 0.1.0 (ISC)\n\nThe package ships no licence file");
  });

  it("is up to date in the repository and names every runtime package of the apps", () => {
    const file = readFileSync(join(REPO, "THIRD_PARTY_NOTICES"), "utf8");
    expect(file).toBe(render(collect()));
    for (const name of ["hono", "react", "croner", "tesseract.js", "pdfjs-dist"]) expect(file).toContain(`\n${name} `);
  });
});
