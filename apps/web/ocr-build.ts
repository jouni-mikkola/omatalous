/**
 * What the build copies for the picture reader of Asetukset > Lainat (`ocrFiles` in vite.config.ts), and the one file
 * of third-party licences that goes with it. Node only: the web app never imports this.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/** Leptonica is compiled into tesseract.js-core. Its licence is not among the package's files. */
const LEPTONICA = `Leptonica, compiled into the WebAssembly cores of tesseract.js-core, is under the BSD 2-clause licence:

Copyright (C) 2001-2020 Leptonica.  All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following
   disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following
   disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \`\`AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL ANY CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

interface Part {
  name: string;
  /** Where the package is installed from: the web app, or a package of the picture reader. */
  from?: "tesseract.js";
  /** What of the build comes from it. */
  note: string;
  /** The package has no licence file: its licence is the text of another part. */
  licenceOf?: string;
  /** More notices, after the licence file. */
  extra?: string;
}

/** Everything the reader carries into `dist`: the files it loads and the packages bundled into its code. */
export const LICENCE_PARTS: readonly Part[] = [
  { name: "pdfjs-dist", note: "Reads the text of a PDF (assets/pdf-*.js and the pdf.js worker file)." },
  { name: "tesseract.js", note: "The picture reader and its worker (assets/ocr-*/worker.min.js)." },
  { name: "tesseract.js-core", from: "tesseract.js", note: "The Tesseract OCR engine as WebAssembly (assets/ocr-*/tesseract-core-*.wasm.js).", extra: LEPTONICA },
  { name: "@tesseract.js-data/fin", licenceOf: "tesseract.js-core", note: "The Finnish language data (assets/ocr-*/fin.traineddata.gz): the tessdata_best model of the Tesseract OCR project, https://github.com/tesseract-ocr/tessdata_best, under the Apache License 2.0. The npm package that carries it says MIT." },
  { name: "@tesseract.js-data/eng", licenceOf: "tesseract.js-core", note: "The English language data (assets/ocr-*/eng.traineddata.gz): the tessdata_best model of the Tesseract OCR project, https://github.com/tesseract-ocr/tessdata_best, under the Apache License 2.0. The npm package that carries it says MIT." },
  { name: "wasm-feature-detect", from: "tesseract.js", note: "Part of the picture reader's code." },
  { name: "idb-keyval", from: "tesseract.js", note: "Part of the picture reader's code." },
  { name: "bmp-js", from: "tesseract.js", note: "Part of the picture reader's code." },
  { name: "zlibjs", from: "tesseract.js", note: "Part of the picture reader's code." },
  { name: "is-url", from: "tesseract.js", note: "Part of the picture reader's code." },
  { name: "regenerator-runtime", from: "tesseract.js", note: "Part of the picture reader's code." },
];

const LICENCE_FILE = /^(licen[cs]e|notice|copying)([.-].*)?$/i;

/** The licence files a package ships, as it ships them. */
function licenceFiles(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((file) => ({ file, text: readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n").trim() }));
}

/**
 * One text for the third-party works the built app carries for the picture reader, from the licence files in
 * node_modules. Apache-2.0 asks that its text goes with every copy, and the minified bundles keep none of it.
 * A package that ships no licence file and names none to use fails the build: nothing goes out unlicensed.
 */
export function thirdPartyLicences(): string {
  const dirs = new Map(LICENCE_PARTS.map((part) => [part.name, packageDir(part.name, part.from ? fromTesseract : require)]));
  const sections = LICENCE_PARTS.map((part) => {
    const dir = dirs.get(part.name)!;
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string; license: string; homepage?: string; repository?: { url?: string } | string };
    const source = pkg.homepage ?? (typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url);
    const head = [`${part.name} ${pkg.version}`, `License: ${pkg.license}`, ...(source ? [`Source: ${source}`] : []), part.note];
    const files = part.licenceOf ? [] : licenceFiles(dir);
    if (!part.licenceOf && files.length === 0) throw new Error(`${part.name} ships no licence file: add its text to LICENCE_PARTS before it goes into the build.`);
    const body = part.licenceOf ? [`The Apache License 2.0 text under ${part.licenceOf} above is the one for this data.`] : files.map(({ file, text }) => `--- ${file} ---\n\n${text}`);
    // some Apache works ship only the short notice of the licence, not its terms
    if (pkg.license === "Apache-2.0" && !part.licenceOf && !files.some(({ text }) => text.includes("TERMS AND CONDITIONS FOR USE"))) body.push("This package ships only the notice above. The terms are those of the Apache License 2.0 text under tesseract.js-core above.");
    return [head.join("\n"), ...body, ...(part.extra ? [part.extra] : [])].join("\n\n");
  });
  const intro = "Third-party software in this app's picture and PDF reader\n\nA picture, a PDF or a text of a loan is read in the browser by the software below, which the app serves from its own files. Each part is given with its licence as its package ships it.";
  const rule = "=".repeat(78);
  return `${intro}\n\n${sections.map((section) => `${rule}\n${section}`).join("\n\n")}\n`;
}
