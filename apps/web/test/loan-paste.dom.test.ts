/**
 * The input box of a new loan: text pasted or typed fills the form, every field read with doubt is marked and blocks
 * the save until the household confirms it, several loans go to a table that saves them all, and a PDF or a picture
 * goes through the reader (replaced here: its own tests are in loan-read.isolated.test.ts).
 */
import type { Loan } from "@banking/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyForm } from "../src/components/loans/form.ts";
import { LoanDraftTable } from "../src/components/loans/LoanDraftTable.tsx";
import { LoanEditor, LoanLinks } from "../src/components/loans/LoanEditor.tsx";
import { ReadAborted, ReadError } from "../src/components/loans/read-source.ts";
import { failing, stubApi } from "./dom-kit.ts";

const reader = vi.hoisted(() => ({ pdf: vi.fn(), picture: vi.fn() }));
vi.mock("../src/components/loans/read-source.ts", async (original) => ({
  ...(await original<typeof import("../src/components/loans/read-source.ts")>()),
  readPdf: reader.pdf,
  readPicture: reader.picture,
}));

const TODAY = "2026-10-12";
const ONE = ["Esimerkkipankki Oyj", "Luoton tyyppi: Kertaluotto", "Myönnetty määrä: 150 000,00 €", "Luoton saldo: 120 000,00 € (30.9.2026)", "Kokonaiskorko: 3,39 %", "Lyhennystapa: Annuiteetti", "Lyhennysväli: 1 kk", "Kuukausierä: 689,20 €", "Viimeinen eräpäivä: 31.10.2046"].join("\n");
const TWO = [ONE, "", "Mallirahoitus Bank AB", "Luoton tyyppi: Jatkuva luotto", "Luottoraja\t2 000,00 €", "Luoton saldo\t1 250,50 €", "Kokonaiskorko\t14,9 %"].join("\n");

const saved = (over: Partial<Loan> = {}): Loan =>
  ({ id: "l1", name: "Kodin laina", kind: "mortgage", lender: "Esimerkkipankki Oyj", grantedCents: 15_000_000, balanceCents: 11_000_000, balanceDate: "2026-08-31", rateBp: 300, reference: null, marginBp: null, rateReviewDate: null, repayment: "annuity", intervalMonths: 1, paymentCents: 60_000, endDate: "2046-10-31", limitCents: null, seriesKey: null, accountId: null, ...over }) as Loan;

const box = () => screen.getByLabelText("Lainan tiedot") as HTMLTextAreaElement;
const button = (name: string) => screen.getByRole("button", { name });
const pick = (file: File) => fireEvent.change(screen.getByLabelText("Valitse kuva tai PDF"), { target: { files: [file] } });
const paste = (text: string) => fireEvent.paste(box(), { clipboardData: { files: [], getData: () => text } });
const confirmAll = () => screen.getAllByRole("checkbox").forEach((c) => !(c as HTMLInputElement).checked && fireEvent.click(c));

function open(onSave = vi.fn(async (_body: unknown) => {}), onSeveral?: (drafts: unknown[]) => void, loans: Loan[] = []) {
  render(h(LoanLinks.Provider, { value: { accounts: [], loans } }, h(LoanEditor, { initial: emptyForm(TODAY), today: TODAY, cancelLabel: "Peruuta", onSeveral, onSave, onCancel: () => {} })));
  return onSave;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  reader.pdf.mockReset();
  reader.picture.mockReset();
});

describe("Asetukset > Talous: the box that reads a loan", () => {
  it("reads pasted text into the form and marks each field as sure or to check, with the line it came from", () => {
    open();
    expect((button("Lue lainan tiedot") as HTMLButtonElement).disabled).toBe(true);
    paste(ONE);
    expect((screen.getByLabelText("Lainan määrä (€)") as HTMLInputElement).value).toBe("150 000,00");
    expect((screen.getByLabelText("Kuukausierä (€)") as HTMLInputElement).value).toBe("689,20");
    // the lender's name is read from a line of its own: to check, with the line it came from, until the household confirms it
    expect(screen.getAllByText("Tarkista").length).toBeGreaterThan(0);
    expect(screen.getByText("Tekstissä: Esimerkkipankki Oyj")).toBeTruthy();
    // a value read with confidence carries no badge and no line
    expect(screen.queryByText("Varma")).toBeNull();
    expect(screen.queryByText("Tekstissä: Kuukausierä: 689,20 €")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Lainanantaja on oikein" }));
    expect(screen.queryByText("Merkitty oikeaksi")).toBeNull();
    expect(screen.getByText("Tekstissä: Esimerkkipankki Oyj")).toBeTruthy();
  });

  it("reads text typed in the box with Lue lainan tiedot, and leaves a paste into typed text alone", () => {
    open();
    fireEvent.change(box(), { target: { value: "jotain" } });
    paste(ONE);
    expect((screen.getByLabelText("Kuukausierä (€)") as HTMLInputElement).value).toBe("");
    fireEvent.change(box(), { target: { value: ONE } });
    fireEvent.click(button("Lue lainan tiedot"));
    expect((screen.getByLabelText("Kuukausierä (€)") as HTMLInputElement).value).toBe("689,20");
  });

  it("will not save while a field is to check, and names it", async () => {
    const onSave = open();
    paste(ONE);
    fireEvent.change(screen.getByLabelText("Laji"), { target: { value: "mortgage" } });
    fireEvent.click(button("Tallenna"));
    expect((await screen.findByText(/^Tarkista vielä:/)).textContent).toMatch(/Merkitse kenttä oikeaksi/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves the loan with the read payment once every field to check is confirmed", async () => {
    const onSave = open();
    paste(ONE);
    fireEvent.change(screen.getByLabelText("Laji"), { target: { value: "mortgage" } });
    confirmAll();
    fireEvent.click(button("Tallenna"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({ kind: "mortgage", lender: "Esimerkkipankki Oyj", grantedCents: 15_000_000, balanceCents: 12_000_000, paymentCents: 68_920, repayment: "annuity" });
  });

  it("leaves a field the text does not give empty and marks it not found, never a zero", () => {
    open();
    paste("Luoton saldo: 120 000,00 €");
    expect((screen.getByLabelText("Lainan määrä (€)") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Marginaali (%)") as HTMLInputElement).value).toBe("");
    expect(screen.getAllByText("Ei löytynyt").length).toBeGreaterThan(0);
  });

  it("changing a field to check counts as confirming it", async () => {
    const onSave = open();
    paste(ONE);
    fireEvent.change(screen.getByLabelText("Laji"), { target: { value: "mortgage" } });
    confirmAll();
    const lender = screen.getByLabelText("Lainanantaja");
    fireEvent.click(within(lender.closest(".loan-field") as HTMLElement).getByRole("checkbox"));
    expect(lender.closest(".loan-field")!.classList.contains("to-check")).toBe(true);
    fireEvent.change(lender, { target: { value: "Toinen Pankki Oyj" } });
    expect(lender.closest(".loan-field")!.classList.contains("to-check")).toBe(false);
    fireEvent.click(button("Tallenna"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it("says so when the text holds no loan, and keeps the form for typing", () => {
    open();
    fireEvent.change(box(), { target: { value: "Tervehdys vain" } });
    fireEvent.click(button("Lue lainan tiedot"));
    expect(screen.getByRole("alert").textContent).toMatch(/Emme löytäneet tekstistä lainan tietoja/);
    expect(screen.getByLabelText("Lainaa jäljellä (€)")).toBeTruthy();
  });

  it("hands several loans to the table, and a loan saved already too", () => {
    const several = vi.fn();
    open(undefined, several);
    paste(TWO);
    expect(several).toHaveBeenCalledTimes(1);
    expect(several.mock.calls[0]![0]).toHaveLength(2);
    cleanup();
    const again = vi.fn();
    open(undefined, again, [saved()]);
    paste(ONE);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("reads a text file and refuses a file that is neither a picture, a PDF nor text", async () => {
    open();
    pick(new File([ONE], "laina.txt", { type: "text/plain" }));
    await waitFor(() => expect((screen.getByLabelText("Lainan määrä (€)") as HTMLInputElement).value).toBe("150 000,00"));
    pick(new File(["x"], "laina.zip", { type: "application/zip" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/ei ole kuva, PDF eikä teksti/);
  });

  it("refuses a file over 25 megabytes without reading it", async () => {
    open();
    const big = new File(["x"], "iso.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    pick(big);
    expect((await screen.findByRole("alert")).textContent).toMatch(/liian suuri/);
    expect(reader.pdf).not.toHaveBeenCalled();
  });

  it("reads a PDF through the reader, and fills the form from its text", async () => {
    reader.pdf.mockResolvedValue(ONE);
    open();
    pick(new File(["%PDF"], "laina.pdf", { type: "application/pdf" }));
    await waitFor(() => expect((screen.getByLabelText("Kuukausierä (€)") as HTMLInputElement).value).toBe("689,20"));
  });

  it("can end a PDF read with Keskeytä and says nothing of it", async () => {
    reader.pdf.mockImplementation((_data: ArrayBuffer, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new ReadAborted()))));
    open();
    pick(new File(["%PDF"], "laina.pdf", { type: "application/pdf" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keskeytä" }));
    await waitFor(() => expect(screen.queryByText("Luemme PDF-tiedostoa…")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("tells why a PDF could not be read", async () => {
    reader.pdf.mockRejectedValue(new ReadError("PDF-tiedosto on salasanalla suojattu. Avaa se ensin ja liitä sen teksti tähän."));
    open();
    pick(new File(["%PDF"], "laina.pdf", { type: "application/pdf" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/salasanalla suojattu/);
  });

  it("reads a picture through the reader, shows the steps, and marks every field it read as Tarkista", async () => {
    let reading!: () => void;
    let loaded!: () => void;
    reader.picture.mockImplementation(
      (_picture: Blob, onProgress: (p: { step: string; share: number }) => void) =>
        new Promise((resolve) => {
          onProgress({ step: "load", share: 0.3 });
          reading = () => onProgress({ step: "read", share: 0.4 });
          loaded = () => resolve(ONE);
        }),
    );
    open();
    pick(new File(["x"], "kuvakaappaus.png", { type: "image/png" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/Valmistelemme kuvan lukijaa/);
    act(() => reading());
    expect(screen.getByRole("status").textContent).toMatch(/^Luemme kuvaa… 40 %/);
    loaded();
    await waitFor(() => expect((screen.getByLabelText("Kuukausierä (€)") as HTMLInputElement).value).toBe("689,20"));
    // read from a picture, a figure that a text gives with confidence is to check too
    const payment = screen.getByLabelText("Kuukausierä (€)").closest(".loan-field") as HTMLElement;
    expect(payment.classList.contains("to-check")).toBe(true);
    expect(reader.picture.mock.calls[0]![0]).toBeInstanceOf(File);
  });

  it("reads a pasted picture, and says so when it holds no loan", async () => {
    reader.picture.mockResolvedValue("Tervehdys vain");
    open();
    fireEvent.paste(box(), { clipboardData: { files: [new File(["x"], "image.png", { type: "image/png" })], getData: () => "" } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Emme löytäneet kuvasta lainan tietoja/);
  });

  it("reads a chosen picture that has no type by its name, and refuses a file that is neither", async () => {
    reader.picture.mockResolvedValue("Tervehdys vain");
    open();
    pick(new File(["x"], "IMG_0042.JPG", { type: "" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Emme löytäneet kuvasta lainan tietoja/);
    expect(reader.picture).toHaveBeenCalledTimes(1);
    pick(new File(["x"], "muistio.zip", { type: "" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Tiedosto ei ole kuva, PDF eikä teksti/);
    expect(reader.picture).toHaveBeenCalledTimes(1);
  });

  it("tells why a picture could not be read", async () => {
    reader.picture.mockRejectedValue(new ReadError("Emme voineet lukea kuvaa. Yritä uudelleen tai liitä lainan tiedot tekstinä."));
    open();
    pick(new File(["x"], "kuva.png", { type: "image/png" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Emme voineet lukea kuvaa/);
  });

  it("tells that a PDF with no text holds only a picture", async () => {
    reader.pdf.mockResolvedValue("  \n ");
    open();
    pick(new File(["%PDF"], "laina.pdf", { type: "application/pdf" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/pelkkä kuva/);
  });
});

describe("the table of the loans a text holds", () => {
  const draftsOf = async () => {
    const { parseLoanText } = await import("@banking/core");
    return parseLoanText(TWO, { asOf: TODAY });
  };

  it("matches a read loan to the saved one of the same lender and amount, and the other is new", async () => {
    render(h(LoanDraftTable, { drafts: await draftsOf(), loans: [saved()], today: TODAY, onSaved: () => {}, onClose: () => {} }));
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects.map((s) => s.value)).toEqual(["l1", ""]);
    expect(screen.getByRole("button", { name: "Tallenna 2 lainaa" })).toBeTruthy();
  });

  it("will not save while a row is to check", async () => {
    const seen = stubApi({});
    render(h(LoanDraftTable, { drafts: await draftsOf(), loans: [saved()], today: TODAY, onSaved: () => {}, onClose: () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "Tallenna 2 lainaa" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Tarkista jokainen merkitty laina/);
    expect(seen).toEqual([]);
  });

  it("saves a confirmed row over the saved loan with PUT and the new one with POST", async () => {
    const seen = stubApi({ "PUT /api/loans/l1": { loan: { id: "l1" } }, "POST /api/loans": { loan: { id: "l2" } } });
    const onSaved = vi.fn();
    render(h(LoanDraftTable, { drafts: await draftsOf(), loans: [saved()], today: TODAY, onSaved, onClose: () => {} }));
    for (const name of ["Tarkista laina Esimerkkipankki Oyj", "Tarkista laina Mallirahoitus Bank AB"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      const dialog = await screen.findByRole("dialog", { hidden: true });
      const kind = within(dialog).getByLabelText("Laji") as HTMLSelectElement;
      if (kind.value === "") fireEvent.change(kind, { target: { value: "credit_line" } });
      within(dialog).getAllByRole("checkbox", { hidden: true }).forEach((c) => !(c as HTMLInputElement).checked && fireEvent.click(c));
      fireEvent.click(within(dialog).getByRole("button", { name: "Valmis", hidden: true }));
      await waitFor(() => expect(document.querySelector("dialog")).toBeNull());
    }
    fireEvent.click(screen.getByRole("button", { name: "Tallenna 2 lainaa" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(2));
    expect(seen.map((s) => `${s.method} ${s.path}`).sort()).toEqual(["POST /api/loans", "PUT /api/loans/l1"]);
    // the saved loan keeps its name; the figures are the text's
    expect(seen.find((s) => s.method === "PUT")!.body).toMatchObject({ name: "Kodin laina", grantedCents: 15_000_000, balanceCents: 12_000_000 });
  });

  it("sends the split of the last payment of a row confirmed in its dialog when it was read with confidence, and none when it was read to check", async () => {
    const last = { date: "2026-09-05", principalCents: 59_501, interestCents: 24_500, feeCents: 0 };
    for (const [confidence, expected] of [["sure", last], ["check", undefined]] as const) {
      const seen = stubApi({ "PUT /api/loans/l1": { loan: { id: "l1" } } });
      const [first] = await draftsOf();
      render(h(LoanDraftTable, { drafts: [{ ...first!, lastPayment: { value: last, line: "Viimeisin maksu", confidence } }], loans: [saved()], today: TODAY, onSaved: () => {}, onClose: () => {} }));
      fireEvent.click(screen.getByRole("button", { name: "Tarkista laina Esimerkkipankki Oyj" }));
      const dialog = await screen.findByRole("dialog", { hidden: true });
      within(dialog).getAllByRole("checkbox", { hidden: true }).forEach((c) => !(c as HTMLInputElement).checked && fireEvent.click(c));
      fireEvent.click(within(dialog).getByRole("button", { name: "Valmis", hidden: true }));
      await waitFor(() => expect(document.querySelector("dialog")).toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "Tallenna laina" }));
      await waitFor(() => expect(seen.length).toBe(1));
      expect((seen[0]!.body as { lastPayment?: unknown }).lastPayment).toEqual(expected);
      cleanup();
    }
  });

  it("keeps the rows that were not saved, and shows the server's reason", async () => {
    stubApi({ "PUT /api/loans/l1": failing(400, { error: "Saldo puuttuu." }) });
    render(h(LoanDraftTable, { drafts: (await draftsOf()).slice(0, 1), loans: [saved()], today: TODAY, onSaved: () => {}, onClose: () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "Tarkista laina Esimerkkipankki Oyj" }));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    within(dialog).getAllByRole("checkbox", { hidden: true }).forEach((c) => !(c as HTMLInputElement).checked && fireEvent.click(c));
    fireEvent.click(within(dialog).getByRole("button", { name: "Valmis", hidden: true }));
    await waitFor(() => expect(document.querySelector("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Tallenna laina" }));
    expect(await screen.findByText("Saldo puuttuu.")).toBeTruthy();
  });
});
