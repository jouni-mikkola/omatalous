import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../../tools/lib/tmp-kit.ts";
import { pictureReaderChunks, shellFiles, shellWorkerSource } from "../shell-build.ts";

function built(files: Record<string, string>): string {
  const dir = tempDir("shell-");
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

describe("the files the service worker keeps", () => {
  it("lists the app's own files and leaves out the PDF reader, the picture reader, the old fonts and the worker itself", () => {
    const out = built({
      "index.html": "<html>",
      "sw.js": "old",
      "manifest.webmanifest": "{}",
      "assets/index-1.js": "a",
      "assets/pdf-Ab3_x.js": "p",
      "assets/pdf.worker.min-Zy9-q.mjs": "w",
      "assets/ocr-0a1b2c3d/worker.min.js": "w",
      "assets/ocr-0a1b2c3d/tesseract-core-simd-lstm.wasm.js": "c",
      "assets/ocr-0a1b2c3d/fin.traineddata.gz": "d",
      "assets/font-1.woff2": "f",
      "assets/font-1.woff": "f",
      "icons/icon-192.png": "p",
    });
    expect(shellFiles(out)).toEqual(["/assets/font-1.woff2", "/assets/index-1.js", "/icons/icon-192.png", "/index.html", "/manifest.webmanifest"]);
  });

  it("leaves out the lazy chunk of the picture reader's library, and keeps the app's own chunks of the same name", () => {
    const out = built({ "index.html": "<html>", "assets/index-1.js": "a", "assets/index-9f8e7d6c.js": "t" });
    expect(shellFiles(out, ["/assets/index-9f8e7d6c.js"])).toEqual(["/assets/index-1.js", "/index.html"]);
    expect(shellFiles(out)).toContain("/assets/index-9f8e7d6c.js");
  });

  it("finds that chunk in the bundle by its library, not by its name", () => {
    const pnpm = "/app/node_modules/.pnpm/tesseract.js@7.0.0/node_modules/tesseract.js/src/index.js";
    expect(
      pictureReaderChunks({
        a: { type: "chunk", fileName: "assets/index-1.js", isDynamicEntry: false, facadeModuleId: "/app/apps/web/src/main.tsx" },
        b: { type: "chunk", fileName: "assets/index-9f8e7d6c.js", isDynamicEntry: true, facadeModuleId: pnpm },
        c: { type: "chunk", fileName: "assets/pdf-Ab3_x.js", isDynamicEntry: true, facadeModuleId: "/app/node_modules/pdfjs-dist/legacy/build/pdf.mjs" },
        d: { type: "chunk", fileName: "assets/data-1.js", isDynamicEntry: true, facadeModuleId: "/app/node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz" },
        e: { type: "asset", fileName: "assets/tesseract.js.css" },
      }),
    ).toEqual(["/assets/index-9f8e7d6c.js"]);
  });

  it("names the cache by the content: a changed file is a new worker", () => {
    const name = (body: string) => {
      const out = built({ "index.html": body, "assets/a.js": "a" });
      return /"name":"(shell-[0-9a-f]{12})"/.exec(shellWorkerSource("const SHELL = __SHELL__;", out, shellFiles(out)))?.[1];
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
