/**
 * What the build puts into the service worker (`shellWorker` in vite.config.ts): the files of the app that it keeps so the
 * app opens with no network, and a cache name made from their content. Node only: the web app never imports this.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** The PDF reader of Lisää laina: its lazy chunk and its worker (over a megabyte), needed only while a loan PDF is read. */
const PDF_READER = /^\/assets\/pdf(?:\.worker\.min)?-[\w-]+\.m?js$/;

/** The picture reader of Lisää laina: its worker, WebAssembly cores and language data (about 11 MB under `assets/ocr-<hash>/`, `ocrFiles` in vite.config.ts), needed only while a loan picture is read. */
const PICTURE_READER = /^\/assets\/ocr-[0-9a-f]{8}\//;

/** The small chunk that `import("tesseract.js")` makes. Its name is the module's (`index`), the same as the app's own, so it is found in the bundle and not by its name. */
const PICTURE_READER_MODULE = /[\\/]tesseract\.js[\\/]/;

/** The addresses of the lazy chunks that hold the picture reader's library, from the bundle Rollup hands to `generateBundle`. */
export function pictureReaderChunks(bundle: Record<string, { type: string; fileName: string; isDynamicEntry?: boolean; facadeModuleId?: string | null }>): string[] {
  return Object.values(bundle)
    .filter((file) => file.type === "chunk" && file.isDynamicEntry && PICTURE_READER_MODULE.test(file.facadeModuleId ?? ""))
    .map((file) => "/" + file.fileName);
}

/** The address of every file of the built app that the worker keeps, sorted. The PDF reader, the picture reader (`lazyChunks`, and its files under `assets/ocr-<hash>/`), the worker itself and the old `.woff` fonts (a browser with a worker reads `.woff2`) stay out, and so do the `.br` and `.gz` copies the server sends in place of a file. */
export function shellFiles(outDir: string, lazyChunks: readonly string[] = []): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push("/" + relative(outDir, path).split(sep).join("/"));
    }
  };
  walk(outDir);
  return found.filter((f) => f !== "/sw.js" && !PDF_READER.test(f) && !PICTURE_READER.test(f) && !lazyChunks.includes(f) && !f.endsWith(".woff") && !f.endsWith(".br") && !f.endsWith(".gz")).sort();
}

/** The worker's source with `__SHELL__` replaced: `{ name: "shell-<hash of the files' names and bytes>", files }`. A changed file is a changed worker, which a browser installs and the old one's cache goes. */
export function shellWorkerSource(template: string, outDir: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
  const shell = { name: `shell-${hash.digest("hex").slice(0, 12)}`, files };
  if (!template.includes("__SHELL__")) throw new Error("sw.js has no __SHELL__ to fill in");
  return template.replace("__SHELL__", JSON.stringify(shell));
}
