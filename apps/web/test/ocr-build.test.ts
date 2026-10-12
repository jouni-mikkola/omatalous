import { describe, expect, it } from "vitest";
import { LICENCE_PARTS, ocrFolder, ocrSources, thirdPartyLicences } from "../ocr-build.ts";

describe("the picture reader's files in the build", () => {
  it("copies the worker, the two cores and the Finnish and English data, and nothing of the relaxed-SIMD core", () => {
    const sources = ocrSources();
    expect([...sources.keys()].sort()).toEqual(["eng.traineddata.gz", "fin.traineddata.gz", "tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "worker.min.js"]);
    expect(ocrFolder(sources)).toMatch(/^assets\/ocr-[0-9a-f]{8}$/);
  });
});

describe("the third-party licence file", () => {
  const text = thirdPartyLicences();

  it("names every package the reader carries with its version and licence", () => {
    expect(LICENCE_PARTS.map((part) => part.name)).toEqual([
      "pdfjs-dist",
      "tesseract.js",
      "tesseract.js-core",
      "@tesseract.js-data/fin",
      "@tesseract.js-data/eng",
      "wasm-feature-detect",
      "idb-keyval",
      "bmp-js",
      "zlibjs",
      "is-url",
      "regenerator-runtime",
    ]);
    for (const { name } of LICENCE_PARTS) expect(text, name).toMatch(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} \\d+\\.\\d+\\.\\d+\\nLicense: (Apache-2\\.0|MIT)$`, "m"));
  });

  it("carries the Apache-2.0 text of each Apache work, the MIT notices and the notice of Leptonica", () => {
    // pdf.js, tesseract.js, its core and wasm-feature-detect ship the whole text, idb-keyval only the notice and so points to it
    expect(text.match(/TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/g)).toHaveLength(4);
    expect(text).toMatch(/idb-keyval [\d.]+\nLicense: Apache-2\.0[\s\S]*?This package ships only the notice above\./);
    expect(text).toContain("Permission is hereby granted, free of charge");
    // the words of leptonica-license.txt: the years, and the liability line that names contributors only
    expect(text).toContain("Copyright (C) 2001-2020 Leptonica.  All rights reserved.");
    expect(text).toContain("IN NO EVENT SHALL ANY CONTRIBUTORS BE LIABLE");
    expect(text).toContain("BSD 2-clause");
    expect(text).toContain("tessdata_best");
  });

  it("holds no package that was left out of the reader's build", () => {
    // pdf.js's canvas for Node is ignored by the workspace and never loaded by the web build
    expect(text).not.toContain("@napi-rs/canvas");
    expect(text).not.toContain("node-fetch");
  });
});
