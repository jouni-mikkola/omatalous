import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../../tools/lib/tmp-kit.ts";
import { shellFiles, shellWorkerSource } from "../shell-build.ts";

function built(files: Record<string, string>): string {
  const dir = tempDir("shell-");
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

describe("the files the service worker keeps", () => {
  it("lists the app's own files and leaves out the picture reader, the licence list, the old fonts and the worker itself", () => {
    const out = built({
      "index.html": "<html>",
      "sw.js": "old",
      "THIRD-PARTY-LICENSES.txt": "x",
      "manifest.webmanifest": "{}",
      "assets/index-1.js": "a",
      "assets/font-1.woff2": "f",
      "assets/font-1.woff": "f",
      "assets/ocr-abcd1234/worker.min.js": "w",
      "icons/icon-192.png": "p",
    });
    expect(shellFiles(out, "assets/ocr-abcd1234")).toEqual(["/assets/font-1.woff2", "/assets/index-1.js", "/icons/icon-192.png", "/index.html", "/manifest.webmanifest"]);
  });

  it("names the cache by the content: a changed file is a new worker", () => {
    const name = (body: string) => {
      const out = built({ "index.html": body, "assets/a.js": "a" });
      return /"name":"(shell-[0-9a-f]{12})"/.exec(shellWorkerSource("const SHELL = __SHELL__;", out, shellFiles(out, "assets/ocr-x")))?.[1];
    };
    expect(name("one")).toMatch(/^shell-[0-9a-f]{12}$/);
    expect(name("one")).toBe(name("one"));
    expect(name("one")).not.toBe(name("two"));
  });

  it("refuses a worker with nothing to fill in", () => {
    const out = built({ "index.html": "x" });
    expect(() => shellWorkerSource("const SHELL = {};", out, ["/index.html"])).toThrow(/__SHELL__/);
  });
});

describe("the manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8")) as { theme_color: string; start_url: string; icons: { src: string }[] };
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  it("has the colour of the header band that index.html gives the browser, and every icon it names", () => {
    expect(manifest.theme_color).toBe(html.match(/<meta name="theme-color" content="(#[0-9a-f]{6})"/i)?.[1]);
    for (const { src } of manifest.icons) expect(existsSync(new URL(`../public${src}`, import.meta.url)), src).toBe(true);
  });

  it("is linked with credentials, so a login proxy in front of the app does not refuse it", () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />');
  });
});
