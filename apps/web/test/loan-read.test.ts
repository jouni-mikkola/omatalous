import { setImmediate as tick } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ocrSources } from "../ocr-build.ts";
import { whatWasPasted } from "../src/components/loans/paste.ts";
import { sizeOfHeader } from "../src/components/loans/picture-size.ts";
import { coreFile, MAX_PIXELS, PLAIN_CORE, ReadAborted, ReadError, readPdf, readPicture, SIMD_CORE, STALL_MS, STALLED, TOO_MANY_PIXELS, UNKNOWN_PICTURE } from "../src/components/loans/read-source.ts";

// The reader's two libraries are replaced: these tests are about what the app does around them (ending a read, the
// stall limit, the core it names, the size it refuses), and none of them reads a real picture.
const tess = vi.hoisted(() => ({ createWorker: vi.fn() }));
const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("tesseract.js", () => tess);
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: pdf.getDocument, GlobalWorkerOptions: {}, VerbosityLevel: { ERRORS: 0 } }));
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({ default: "worker.mjs" }));

// The Worker that Tesseract starts: the test keeps every one to see whether it was ended.
const started: FakeWorker[] = [];
class FakeWorker {
  ended = false;
  constructor(public readonly url: string | URL) {
    started.push(this);
  }
  terminate() {
    this.ended = true;
  }
}

const png = (width: number, height: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
};
const picture = (width = 800, height = 600) => new Blob([png(width, height)], { type: "image/png" });

interface Options {
  workerPath: string;
  logger: (m: { status: string; progress: number }) => void;
  errorHandler: (e: unknown) => void;
}
/** A createWorker that starts a Worker like the real one does, then does what `then` says. */
const startsWorker = (then: (options: Options) => unknown) =>
  tess.createWorker.mockImplementation((_langs: string[], _oem: number, options: Options) => {
    new Worker(options.workerPath);
    return then(options);
  });
const never = () => new Promise<never>(() => {});
/** Waits on the real event loop (the fake clock of a test does not move it) until the reader has got as far as `done`. */
const until = async (done: () => boolean) => {
  for (let i = 0; i < 500 && !done(); i++) await tick();
  expect(done()).toBe(true);
};
const reads = (text: string) => () => Promise.resolve({ recognize: async () => ({ data: { text } }), terminate: vi.fn(async () => {}) });

beforeEach(() => {
  started.length = 0;
  tess.createWorker.mockReset();
  pdf.getDocument.mockReset();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("__OCR_DIR__", "assets/ocr-12345678");
  vi.stubGlobal("location", { href: "http://localhost:8080/" });
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close() {} })));
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }) }) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the picture reader", () => {
  it("reads a picture with the SIMD core, from the app's own folder, and ends its worker", async () => {
    startsWorker(reads("Luoton saldo: 8 450,00 €"));
    const text = await readPicture(picture(), () => {}, new AbortController().signal);
    expect(text).toContain("8 450,00");
    const [langs, , options] = tess.createWorker.mock.calls[0]!;
    expect(langs).toEqual(["fin", "eng"]);
    expect(options).toMatchObject({ workerPath: "http://localhost:8080/assets/ocr-12345678/worker.min.js", corePath: `http://localhost:8080/assets/ocr-12345678/${SIMD_CORE}`, langPath: "http://localhost:8080/assets/ocr-12345678/", workerBlobURL: false });
    expect(started.map((w) => w.ended)).toEqual([true]);
    // the Worker a library starts is only watched while createWorker runs
    expect(globalThis.Worker).toBe(FakeWorker);
  });

  it("names the plain core for a browser without WebAssembly SIMD", () => {
    const validate = vi.spyOn(WebAssembly, "validate");
    validate.mockReturnValue(true);
    expect(coreFile()).toBe(SIMD_CORE);
    validate.mockReturnValue(false);
    expect(coreFile()).toBe(PLAIN_CORE);
  });

  it("only names cores that the build carries, and not the relaxed-SIMD one", () => {
    const carried = [...ocrSources().keys()];
    expect(carried).toContain(SIMD_CORE);
    expect(carried).toContain(PLAIN_CORE);
    expect(carried.filter((name) => /relaxed/.test(name))).toEqual([]);
  });

  it("ends the worker when a newer read replaces this one, also while it is still starting", async () => {
    startsWorker(never);
    const stop = new AbortController();
    const read = readPicture(picture(), () => {}, stop.signal);
    const ended = expect(read).rejects.toBeInstanceOf(ReadAborted);
    await until(() => started.length === 1);
    expect(started[0]!.ended).toBe(false);
    stop.abort();
    await ended;
    expect(started[0]!.ended).toBe(true);
  });

  it("ends the worker of a running read, and does not start one for a signal that is already ended", async () => {
    const terminate = vi.fn(async () => {});
    const recognize = vi.fn(never);
    startsWorker(() => Promise.resolve({ recognize, terminate }));
    const stop = new AbortController();
    const read = readPicture(picture(), () => {}, stop.signal);
    const ended = expect(read).rejects.toBeInstanceOf(ReadAborted);
    await until(() => recognize.mock.calls.length === 1);
    expect(terminate).not.toHaveBeenCalled();
    stop.abort();
    await ended;
    expect(terminate).toHaveBeenCalled();
    expect(started[0]!.ended).toBe(true);

    tess.createWorker.mockClear();
    await expect(readPicture(picture(), () => {}, stop.signal)).rejects.toBeInstanceOf(ReadAborted);
    expect(tess.createWorker).not.toHaveBeenCalled();
  });

  it("ends the worker when the start fails, whether createWorker rejects or only reports the error", async () => {
    startsWorker(() => Promise.reject(new Error("no worker")));
    await expect(readPicture(picture(), () => {}, new AbortController().signal)).rejects.toMatchObject({ message: "Kuvaa ei voitu lukea. Yritä uudelleen tai liitä lainan tiedot tekstinä." });
    expect(started.map((w) => w.ended)).toEqual([true]);

    // a language file that fails to load makes createWorker wait for good and calls the error handler instead
    started.length = 0;
    startsWorker((options) => {
      queueMicrotask(() => options.errorHandler("Network error while fetching fin.traineddata.gz"));
      return never();
    });
    const failed = readPicture(picture(), () => {}, new AbortController().signal);
    await expect(failed).rejects.toBeInstanceOf(ReadError);
    expect(started.map((w) => w.ended)).toEqual([true]);
  });

  it("gives up on a read that stalls, with a sentence that says what to do next, and ends the worker", async () => {
    vi.useFakeTimers();
    startsWorker(never);
    const read = readPicture(picture(), () => {}, new AbortController().signal);
    const stalled = expect(read).rejects.toMatchObject({ message: STALLED });
    await until(() => started.length === 1);
    await vi.advanceTimersByTimeAsync(STALL_MS - 1);
    expect(started.map((w) => w.ended)).toEqual([false]);
    await vi.advanceTimersByTimeAsync(1);
    await stalled;
    expect(started.map((w) => w.ended)).toEqual([true]);
    expect(STALLED).toMatch(/Yritä uudelleen tai liitä lainan tiedot tekstinä\.$/);
  });

  it("counts a sign of life from the reader as progress, so a slow download is not given up on", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    startsWorker((options) => {
      setTimeout(() => options.logger({ status: "loading language traineddata", progress: 0.5 }), STALL_MS - 1000);
      setTimeout(() => options.logger({ status: "loading language traineddata", progress: 1 }), 2 * STALL_MS - 2000);
      return never();
    });
    const read = readPicture(picture(), (p) => void seen.push(`${p.step} ${p.share}`), new AbortController().signal);
    const stalled = expect(read).rejects.toMatchObject({ message: STALLED });
    await until(() => started.length === 1);
    await vi.advanceTimersByTimeAsync(2 * STALL_MS - 2000 + STALL_MS - 1);
    expect(started.map((w) => w.ended)).toEqual([false]);
    expect(seen).toEqual(["load 0.5", "load 1"]);
    await vi.advanceTimersByTimeAsync(1);
    await stalled;
  });
});

describe("a picture too large to open", () => {
  it("is refused from its header, before the browser decodes it", async () => {
    startsWorker(reads("x"));
    // 20 000 x 20 000 is 1.6 GB decoded, from a file of a few kilobytes
    await expect(readPicture(picture(20_000, 20_000), () => {}, new AbortController().signal)).rejects.toMatchObject({ message: TOO_MANY_PIXELS });
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(tess.createWorker).not.toHaveBeenCalled();
    expect(TOO_MANY_PIXELS).toContain("40 miljoonaa");
  });

  it("is let through at the limit and refused one pixel row over it", async () => {
    startsWorker(reads("Luoton saldo: 1,00 €"));
    await expect(readPicture(picture(8000, MAX_PIXELS / 8000), () => {}, new AbortController().signal)).resolves.toContain("1,00");
    await expect(readPicture(picture(8000, MAX_PIXELS / 8000 + 1), () => {}, new AbortController().signal)).rejects.toMatchObject({ message: TOO_MANY_PIXELS });
  });

  it("is refused when the format has no size to read, so nothing unchecked is decoded", async () => {
    await expect(readPicture(new Blob(["<svg></svg>"], { type: "image/svg+xml" }), () => {}, new AbortController().signal)).rejects.toMatchObject({ message: UNKNOWN_PICTURE });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  const at = (b: Uint8Array, offset: number, bytes: number[]) => (b.set(bytes, offset), b);
  const be32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const le16 = (n: number) => [n & 255, n >> 8];
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

  it("reads the size of a PNG, JPEG, GIF, WebP, BMP and AVIF header", () => {
    expect(sizeOfHeader(png(1082, 2402))).toEqual({ width: 1082, height: 2402 });
    // JPEG: a start marker, an application segment with metadata, then the start of frame (height before width)
    const jpeg = new Uint8Array(40);
    at(jpeg, 0, [0xff, 0xd8, 0xff, 0xe1, 0, 6, 1, 2, 3, 4, 0xff, 0xc2, 0, 11, 8, ...[4000 >> 8, 4000 & 255], ...[3000 >> 8, 3000 & 255], 3]);
    expect(sizeOfHeader(jpeg)).toEqual({ width: 3000, height: 4000 });
    expect(sizeOfHeader(at(new Uint8Array(12), 0, [...ascii("GIF89a"), ...le16(640), ...le16(480)]))).toEqual({ width: 640, height: 480 });
    const bmp = at(new Uint8Array(30), 0, ascii("BM"));
    at(bmp, 14, [40, 0, 0, 0]);
    new DataView(bmp.buffer).setInt32(18, 1200, true);
    new DataView(bmp.buffer).setInt32(22, -900, true);
    expect(sizeOfHeader(bmp)).toEqual({ width: 1200, height: 900 });
    // WebP: lossless, extended and lossy
    const lossless = at(new Uint8Array(40), 0, [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8L"), 0, 0, 0, 0, 0x2f]);
    new DataView(lossless.buffer).setUint32(21, (999 | (1999 << 14)) >>> 0, true);
    expect(sizeOfHeader(lossless)).toEqual({ width: 1000, height: 2000 });
    const extended = at(new Uint8Array(40), 0, [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8X"), 0, 0, 0, 0, 0, 0, 0, 0, ...[4999 & 255, 4999 >> 8, 0], ...[2999 & 255, 2999 >> 8, 0]]);
    expect(sizeOfHeader(extended)).toEqual({ width: 5000, height: 3000 });
    const lossy = at(new Uint8Array(40), 0, [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 "), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(720), ...le16(1280)]);
    expect(sizeOfHeader(lossy)).toEqual({ width: 720, height: 1280 });
    // AVIF and HEIC: the extent box of the largest image counts
    const avif = at(new Uint8Array(80), 0, [0, 0, 0, 24, ...ascii("ftypavif")]);
    at(avif, 30, [...ascii("ispe"), 0, 0, 0, 0, ...be32(320), ...be32(240)]);
    at(avif, 50, [...ascii("ispe"), 0, 0, 0, 0, ...be32(12_000), ...be32(9000)]);
    expect(sizeOfHeader(avif)).toEqual({ width: 12_000, height: 9000 });
  });

  it("answers null for bytes that are no picture, a cut-off header and an empty picture", () => {
    expect(sizeOfHeader(new TextEncoder().encode("Luoton saldo: 120 000,00 €"))).toBeNull();
    expect(sizeOfHeader(png(10, 10).slice(0, 18))).toBeNull();
    expect(sizeOfHeader(png(0, 10))).toBeNull();
    expect(sizeOfHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0]))).toBeNull();
    expect(sizeOfHeader(new Uint8Array())).toBeNull();
  });
});

describe("the PDF reader", () => {
  const page = { getTextContent: async () => ({ items: [{ str: "Luoton saldo: 21 300,00 €", transform: [1, 0, 0, 1, 10, 700], width: 200, height: 12 }] }) };
  const task = (promise: Promise<unknown>) => ({ promise, destroy: vi.fn(async () => {}) });

  it("reads the lines of a text layer and ends the task", async () => {
    const t = task(Promise.resolve({ numPages: 1, getPage: async () => page }));
    pdf.getDocument.mockReturnValue(t);
    await expect(readPdf(new ArrayBuffer(8), new AbortController().signal)).resolves.toBe("Luoton saldo: 21 300,00 €");
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it("ends the task when a newer read replaces it", async () => {
    const t = task(never());
    pdf.getDocument.mockReturnValue(t);
    const stop = new AbortController();
    const read = readPdf(new ArrayBuffer(8), stop.signal);
    const ended = expect(read).rejects.toBeInstanceOf(ReadAborted);
    await until(() => pdf.getDocument.mock.calls.length === 1);
    expect(t.destroy).not.toHaveBeenCalled();
    stop.abort();
    await ended;
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it("gives up on a PDF that stalls, with a sentence that says what to do next, and ends the task", async () => {
    vi.useFakeTimers();
    const t = task(never());
    pdf.getDocument.mockReturnValue(t);
    const read = readPdf(new ArrayBuffer(8), new AbortController().signal);
    const stalled = expect(read).rejects.toMatchObject({ message: STALLED });
    await until(() => pdf.getDocument.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(STALL_MS);
    await stalled;
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it("tells a password-protected PDF from one that cannot be read", async () => {
    pdf.getDocument.mockImplementation(() => task(Promise.reject(Object.assign(new Error("locked"), { name: "PasswordException" }))));
    await expect(readPdf(new ArrayBuffer(8), new AbortController().signal)).rejects.toMatchObject({ message: expect.stringContaining("salasanalla") });
    pdf.getDocument.mockImplementation(() => task(Promise.reject(new Error("broken"))));
    await expect(readPdf(new ArrayBuffer(8), new AbortController().signal)).rejects.toMatchObject({ message: expect.stringContaining("ei voitu lukea") });
  });
});

describe("what a paste brings in", () => {
  const file = (name: string, type: string) => new File(["x"], name, { type });
  const shot = file("image.png", "image/png");
  const LISTING = "Esimerkkipankki Oyj\nLuoton saldo: 120 000,00 €";

  it("reads a picture beside non-empty text as the text (Word and Excel put both on the clipboard)", () => {
    expect(whatWasPasted([shot], LISTING)).toEqual({ text: LISTING });
  });

  it("reads a picture alone as the picture, also when the text is empty or blank", () => {
    expect(whatWasPasted([shot], "")).toEqual({ file: shot });
    expect(whatWasPasted([shot], " \n ")).toEqual({ file: shot });
  });

  it("reads a copied file, whose text is its own name, as the file", () => {
    expect(whatWasPasted([shot], "image.png")).toEqual({ file: shot });
    expect(whatWasPasted([shot], " image.png\n")).toEqual({ file: shot });
  });

  it("reads a PDF as the file whatever text is beside it, and text alone as text", () => {
    const statement = file("lainat.pdf", "application/pdf");
    expect(whatWasPasted([statement], LISTING)).toEqual({ file: statement });
    expect(whatWasPasted([], LISTING)).toEqual({ text: LISTING });
    expect(whatWasPasted([], "  ")).toBeNull();
    expect(whatWasPasted([file("muistio.zip", "application/zip")], "")).toBeNull();
  });
});
