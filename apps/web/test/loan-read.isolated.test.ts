import { setImmediate as tick } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@banking/core/english";
import "@banking/core/late";
import { type PdfTextPiece, pdfLines } from "../src/components/loans/pdf-lines.ts";
import { whatWasPasted } from "../src/components/loans/paste.ts";
import { ReadAborted, readPdf, STALL_MS } from "../src/components/loans/read-source.ts";

// pdf.js is replaced: these tests are about what the app does around it (ending a read, the stall limit, what it tells
// the household). The e2e test reads a real PDF.
const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: pdf.getDocument, GlobalWorkerOptions: {}, VerbosityLevel: { ERRORS: 0 } }));
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({ default: "worker.mjs" }));

const never = () => new Promise<never>(() => {});
/** Waits on the real event loop (the fake clock of a test does not move it) until `done`. */
const until = async (done: () => boolean) => {
  for (let i = 0; i < 500 && !done(); i++) await tick();
  expect(done()).toBe(true);
};

beforeEach(() => pdf.getDocument.mockReset());
afterEach(() => vi.useRealTimers());

describe("the PDF reader", () => {
  const page = { getTextContent: async () => ({ items: [{ str: "Luoton saldo: 21 300,00 €", transform: [1, 0, 0, 1, 10, 700], width: 200, height: 12 }] }) };
  const task = (promise: Promise<unknown>) => ({ promise, destroy: vi.fn(async () => {}) });

  it("reads the lines of a text layer and ends the task", async () => {
    const t = task(Promise.resolve({ numPages: 1, getPage: async () => page }));
    pdf.getDocument.mockReturnValue(t);
    await expect(readPdf(new ArrayBuffer(8), new AbortController().signal)).resolves.toBe("Luoton saldo: 21 300,00 €");
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it("reads no more than 20 pages", async () => {
    const getPage = vi.fn(async () => page);
    pdf.getDocument.mockReturnValue(task(Promise.resolve({ numPages: 99, getPage })));
    await readPdf(new ArrayBuffer(8), new AbortController().signal);
    expect(getPage).toHaveBeenCalledTimes(20);
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
    const stalled = expect(read).rejects.toMatchObject({ message: expect.stringContaining("jumittui") });
    await until(() => pdf.getDocument.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(STALL_MS);
    await stalled;
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it("tells a password-protected PDF from one that cannot be read", async () => {
    pdf.getDocument.mockImplementation(() => task(Promise.reject(Object.assign(new Error("locked"), { name: "PasswordException" }))));
    await expect(readPdf(new ArrayBuffer(8), new AbortController().signal)).rejects.toMatchObject({ message: expect.stringContaining("salasanalla") });
    pdf.getDocument.mockImplementation(() => task(Promise.reject(new Error("broken"))));
    await expect(readPdf(new ArrayBuffer(8), new AbortController().signal)).rejects.toMatchObject({ message: expect.stringContaining("Emme voineet lukea") });
  });
});

describe("the lines of a text layer", () => {
  const piece = (str: string, x: number, y: number, width = str.length * 6): PdfTextPiece => ({ str, transform: [1, 0, 0, 1, x, y], width, height: 12 });

  it("puts a label and its value, far apart on one row, on one line with a tab between them", () => {
    expect(pdfLines([piece("Luoton saldo", 10, 700), piece("21 300,00 €", 300, 700)])).toEqual(["Luoton saldo\t21 300,00 €"]);
  });

  it("joins pieces that touch with a space, and keeps the rows top first whatever order the file drew them", () => {
    expect(pdfLines([piece("Korko", 10, 680), piece("3,39 %", 43, 680), piece("Luoton saldo", 10, 700)])).toEqual(["Luoton saldo", "Korko 3,39 %"]);
  });

  it("takes pieces a hair off the baseline for one row, and drops blank pieces", () => {
    expect(pdfLines([piece("A", 10, 700), piece("B", 20, 700.4), piece("  ", 80, 700), piece("C", 10, 650)])).toEqual(["A B", "C"]);
  });
});

describe("what a paste brings in", () => {
  const file = (name: string, type: string) => new File(["x"], name, { type });
  const LISTING = "Esimerkkipankki Oyj\nLuoton saldo: 120 000,00 €";

  it("reads a PDF as the file whatever text is beside it, and text alone as text", () => {
    const statement = file("lainat.pdf", "application/pdf");
    expect(whatWasPasted([statement], LISTING)).toEqual({ file: statement });
    expect(whatWasPasted([], LISTING)).toEqual({ text: LISTING });
    expect(whatWasPasted([], "  ")).toBeNull();
    expect(whatWasPasted([file("muistio.zip", "application/zip")], "")).toBeNull();
  });

  it("reads a copied file, whose text is its own name, as nothing to read", () => {
    expect(whatWasPasted([file("kuva.png", "image/png")], "kuva.png")).toBeNull();
  });
});
