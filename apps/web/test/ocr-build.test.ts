import { describe, expect, it } from "vitest";
import { ocrFolder, ocrSources } from "../ocr-build.ts";

describe("the picture reader's files in the build", () => {
  it("copies the worker, the two cores and the Finnish and English data, and nothing of the relaxed-SIMD core", () => {
    const sources = ocrSources();
    expect([...sources.keys()].sort()).toEqual(["eng.traineddata.gz", "fin.traineddata.gz", "tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "worker.min.js"]);
    expect(ocrFolder(sources)).toMatch(/^assets\/ocr-[0-9a-f]{8}$/);
  });
});
