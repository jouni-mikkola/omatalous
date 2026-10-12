/**
 * The text of a picture or a PDF of a loan, read in the browser: nothing is sent anywhere. pdf.js reads a PDF's text
 * layer and Tesseract reads a picture. Both are large, so each is loaded when the first file of its kind arrives, and
 * both come from the app's own address (the Content-Security-Policy allows no other).
 *
 * A read can be ended: by its signal (a newer file, Keskeytä, the page closing) and by a stall limit. Either way the
 * Tesseract worker and the pdf.js task are ended too, so a read that is dropped does not go on using the phone.
 */
import type { Worker as Reader } from "tesseract.js";
import { type PdfTextPiece, pdfLines } from "./pdf-lines.ts";
import { pictureSize } from "./picture-size.ts";
import { tidyPictureText } from "./picture-text.ts";

/** The folder of the Tesseract worker, core and language data in the build (`ocrFiles` in vite.config.ts). */
declare const __OCR_DIR__: string;

/** A file that could not be read, with a sentence for the household. */
export class ReadError extends Error {}
/** The read was ended on purpose (a newer file, Keskeytä): there is nothing to tell the household. */
export class ReadAborted extends Error {}

/** A loan statement is a page or two: later pages are not read. */
const MAX_PDF_PAGES = 20;
/** A read that has made no move for this long is given up. A page of a PDF and every step of the picture reader restart the clock. */
export const STALL_MS = 120_000;
/** A picture over this many pixels is refused before it is decoded: it would fill the memory of a phone. */
export const MAX_PIXELS = 40_000_000;

export const STALLED = "Lukeminen ei edennyt, joten se keskeytettiin. Yritä uudelleen tai liitä lainan tiedot tekstinä.";
export const TOO_MANY_PIXELS = "Kuva on liian suuri, yli 40 miljoonaa pikseliä. Ota lainan tiedoista kuvakaappaus.";
export const UNKNOWN_PICTURE = "Kuvan muotoa ei tunnistettu. Ota lainan tiedoista kuvakaappaus (PNG tai JPEG).";

/**
 * Runs one read under a stall limit. `run` gets a signal that ends when the outer one does or the clock runs out, and
 * `alive` to restart the clock. A read that stalls ends with a sentence that says what to do next.
 */
async function guarded<T>(outer: AbortSignal, run: (stop: AbortSignal, alive: () => void) => Promise<T>): Promise<T> {
  if (outer.aborted) throw new ReadAborted();
  const inner = new AbortController();
  const follow = () => inner.abort();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      inner.abort();
    }, STALL_MS);
  };
  outer.addEventListener("abort", follow, { once: true });
  alive();
  try {
    return await run(inner.signal, alive);
  } catch (err) {
    throw stalled && !outer.aborted ? new ReadError(STALLED) : err;
  } finally {
    clearTimeout(timer);
    outer.removeEventListener("abort", follow);
  }
}

/** `work`, or a `ReadAborted` as soon as `stop` ends, also when `work` never settles. */
function raced<T>(work: Promise<T>, stop: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (stop.aborted) return reject(new ReadAborted());
    const onStop = () => reject(new ReadAborted());
    stop.addEventListener("abort", onStop, { once: true });
    work.then(resolve, reject).finally(() => stop.removeEventListener("abort", onStop));
  });
}

export async function readPdf(data: ArrayBuffer, signal: AbortSignal): Promise<string> {
  return guarded(signal, async (stop, alive) => {
    // the legacy build runs on the browsers of older phones and tablets too
    const [pdfjs, worker] = await raced(Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]), stop);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    // only the text is read: no fonts, pictures or colour profiles, so nothing else is fetched or compiled
    const task = pdfjs.getDocument({ data, useWorkerFetch: false, useWasm: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: pdfjs.VerbosityLevel.ERRORS });
    // destroy ends pdf.js's own worker and settles a task that is still opening. It is not awaited: a worker that
    // has stalled never answers it.
    let destroyed = false;
    const end = () => {
      if (destroyed) return;
      destroyed = true;
      void task.destroy().catch(() => {});
    };
    stop.addEventListener("abort", end, { once: true });
    try {
      const doc = await raced(task.promise, stop);
      const lines: string[] = [];
      for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
        alive();
        const page = await raced(doc.getPage(n), stop);
        const content = await raced(page.getTextContent(), stop);
        lines.push(...pdfLines(content.items.filter((item): item is typeof item & PdfTextPiece => "str" in item)));
      }
      return lines.join("\n");
    } catch (err) {
      if (stop.aborted) throw new ReadAborted();
      if ((err as Error).name === "PasswordException") throw new ReadError("PDF on suojattu salasanalla. Liitä lainasta kuvakaappaus tai teksti.");
      throw new ReadError("PDF-tiedostoa ei voitu lukea. Liitä lainasta kuvakaappaus tai teksti.");
    } finally {
      stop.removeEventListener("abort", end);
      end();
    }
  });
}

/** `load`: the reader and its language data are on their way. `read`: the picture is being read, `share` of it done. */
export interface PictureProgress {
  step: "load" | "read";
  share: number;
}

/**
 * The reader finds letters best when they are some 30 pixels tall. A small picture is drawn larger first, and a camera
 * picture smaller: its extra pixels only cost time. Measured on made-up screenshots of a phone (412 points wide at
 * 1x to 3.5x) and of a desktop (1366 and 1920 wide): every field was read at each size with these limits.
 */
const SMALL_PIXELS = 1_200_000;
const LARGE_PIXELS = 6_000_000;

/** The picture on a canvas at the size it is read at. The browser opens it, so every format the browser shows works. */
async function drawn(picture: Blob): Promise<HTMLCanvasElement> {
  const declared = await pictureSize(picture);
  if (!declared) throw new ReadError(UNKNOWN_PICTURE);
  if (declared.width * declared.height > MAX_PIXELS) throw new ReadError(TOO_MANY_PIXELS);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(picture);
  } catch {
    throw new ReadError("Selain ei osaa avata tätä kuvaa. Kokeile kuvakaappausta (PNG tai JPEG).");
  }
  const pixels = bitmap.width * bitmap.height;
  const scale = pixels < SMALL_PIXELS ? Math.min(2, Math.sqrt((2 * SMALL_PIXELS) / pixels)) : pixels > LARGE_PIXELS ? Math.sqrt(LARGE_PIXELS / pixels) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  // a picture with see-through parts is read as dark text on white
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** The two cores the build carries (`ocrFiles`): with WebAssembly SIMD, and without it for browsers that have none. */
export const SIMD_CORE = "tesseract-core-simd-lstm.wasm.js";
export const PLAIN_CORE = "tesseract-core-lstm.wasm.js";
/** The test for SIMD that wasm-feature-detect (a dependency of tesseract.js) makes: a module with one SIMD instruction. */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

/**
 * Tesseract picks a core by itself from a folder, and prefers a relaxed-SIMD one the build does not carry, so the
 * file is named here.
 */
export const coreFile = (): string => (WebAssembly.validate(SIMD_PROBE) ? SIMD_CORE : PLAIN_CORE);

/** The text of a picture, in Finnish and English. `onProgress` is called many times while it runs. */
export async function readPicture(picture: Blob, onProgress: (progress: PictureProgress) => void, signal: AbortSignal): Promise<string> {
  return guarded(signal, async (stop, alive) => {
    // createWorker starts its Worker before it returns and hands it back only when the start went well. One that
    // fails or stalls leaves the Worker running, so the ones it starts are kept here to be ended with the read.
    const spawned: Worker[] = [];
    let reader: Reader | undefined;
    const end = () => {
      for (const worker of spawned) worker.terminate();
      void reader?.terminate().catch(() => {});
    };
    stop.addEventListener("abort", end, { once: true });
    try {
      const canvas = await raced(drawn(picture), stop);
      const { createWorker } = await raced(import("tesseract.js"), stop);
      const base = new URL(`${import.meta.env.BASE_URL}${__OCR_DIR__}/`, location.href).href;
      // a worker whose data fails to load throws inside its message handler, which no one here can catch
      let broke!: (reason: unknown) => void;
      const failed = new Promise<never>((_, reject) => (broke = reject));
      failed.catch(() => {});
      alive();
      const Native = globalThis.Worker;
      globalThis.Worker = class extends Native {
        constructor(...args: ConstructorParameters<typeof Native>) {
          super(...args);
          spawned.push(this);
        }
      };
      let starting: Promise<Reader>;
      try {
        starting = createWorker(["fin", "eng"], 1, {
          workerPath: `${base}worker.min.js`,
          corePath: `${base}${coreFile()}`,
          langPath: base,
          // the worker is started from the app's own address: a blob address would need its own line in the CSP
          workerBlobURL: false,
          // the server caches these files for good, so no second copy goes to the browser's database
          cacheMethod: "none",
          logger: (m) => {
            if (stop.aborted) return;
            alive();
            onProgress({ step: m.status === "recognizing text" ? "read" : "load", share: m.progress });
          },
          errorHandler: (reason) => broke(new Error(String(reason))),
        });
      } finally {
        globalThis.Worker = Native;
      }
      reader = await raced(Promise.race([starting, failed]), stop);
      alive();
      return tidyPictureText((await raced(reader.recognize(canvas), stop)).data.text);
    } catch (err) {
      if (stop.aborted) throw new ReadAborted();
      if (err instanceof ReadError) throw err;
      throw new ReadError("Kuvaa ei voitu lukea. Yritä uudelleen tai liitä lainan tiedot tekstinä.");
    } finally {
      stop.removeEventListener("abort", end);
      end();
    }
  });
}
