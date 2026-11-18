/**
 * What the build copies for the picture reader of Asetukset > Lainat (`ocrFiles` in vite.config.ts). The licences of
 * these files are in THIRD_PARTY_NOTICES (tools/third-party-notices.mjs). Node only: the web app never imports this.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** The folder of an installed package, found from the file `from` the way that file would import it. */
function packageDir(name: string, from: NodeJS.Require = require): string {
  try {
    return dirname(from.resolve(`${name}/package.json`));
  } catch {
    // a package whose exports hide package.json: walk up from its entry file
    let dir = dirname(from.resolve(name));
    while (!existsSync(join(dir, "package.json")) || JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name !== name) dir = dirname(dir);
    return dir;
  }
}

const tesseractDir = packageDir("tesseract.js");
/** tesseract.js's own dependencies sit beside it in pnpm's store, not where the web app can import them. */
const fromTesseract = createRequire(join(tesseractDir, "package.json"));

/**
 * The files the reader loads while it runs, by the name under `assets/ocr-<hash>/`. Two WebAssembly cores, the one with
 * SIMD and the one without: `coreFile` in read-source.ts names the one to load. Tesseract's relaxed-SIMD core would
 * add 3.9 MB for a speed gain nobody measured, and the English data is there for a bank page in English.
 */
export function ocrSources(): Map<string, string> {
  const core = packageDir("tesseract.js-core", fromTesseract);
  return new Map<string, string>([
    ["worker.min.js", join(tesseractDir, "dist/worker.min.js")],
    ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"].map((name): [string, string] => [name, join(core, name)]),
    ...["fin", "eng"].map((lang): [string, string] => [`${lang}.traineddata.gz`, join(packageDir(`@tesseract.js-data/${lang}`), "4.0.0_best_int", `${lang}.traineddata.gz`)]),
  ]);
}

/** The folder under `assets/` named by the content of the files, so the server caches it like every hashed file. */
export function ocrFolder(sources: Map<string, string>): string {
  const hash = createHash("sha256");
  for (const [name, path] of sources) hash.update(name).update(readFileSync(path));
  return `assets/ocr-${hash.digest("hex").slice(0, 8)}`;
}
