/**
 * The text of a PDF of a loan, read in the browser: nothing is sent anywhere. pdf.js reads the PDF's text layer. It is
 * large, so it loads when the first PDF arrives, and it comes from the app's own address (the Content-Security-Policy
 * allows no other).
 *
 * A read can be ended: by its signal (a newer file, Keskeytä, the page closing) and by a stall limit. Either way the
 * pdf.js task is ended too, so a read that is dropped does not go on using the phone.
 */
import { t } from "../../text.ts";
import { type PdfTextPiece, pdfLines } from "./pdf-lines.ts";

/** A file that could not be read, with a sentence for the household. */
export class ReadError extends Error {}
/** The read was ended on purpose (a newer file, Keskeytä): there is nothing to tell the household. */
export class ReadAborted extends Error {}

/** A loan statement is a page or two: later pages are not read. */
const MAX_PDF_PAGES = 20;
/** A read that has made no move for this long is given up. Each page of a PDF restarts the clock. */
export const STALL_MS = 120_000;

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
    throw stalled && !outer.aborted ? new ReadError(t("set.ln.reading_stalled")) : err;
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
      if ((err as Error).name === "PasswordException") throw new ReadError(t("set.ln.the_pdf_is_locked"));
      throw new ReadError(t("set.ln.the_pdf_could_not_be"));
    } finally {
      stop.removeEventListener("abort", end);
      end();
    }
  });
}
