import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement as h } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReadAborted, ReadError } from "../src/components/loans/read-source.ts";
import { LoanIntake } from "../src/pages/settings/LoanIntake.tsx";
import { failing, stubApi } from "./dom-kit.ts";

const reader = vi.hoisted(() => ({ pdf: vi.fn(), picture: vi.fn() }));
vi.mock("../src/components/loans/read-source.ts", async (original) => ({
  ...(await original<typeof import("../src/components/loans/read-source.ts")>()),
  readPdf: reader.pdf,
  readPicture: reader.picture,
}));

const TODAY = "2026-10-12";
const LISTING = [
  "Esimerkkipankki Oyj",
  "Myönnetty määrä: 150 000,00 €",
  "Luoton saldo: 120 000,00 € (30.9.2026)",
  "Kokonaiskorko: 3,39 %",
  "Lyhennystapa: Annuiteetti",
  "Lyhennysväli: 1 kk",
  "Kuukausierä: 689,20 €",
  "Viimeinen eräpäivä: 31.10.2046",
].join("\n");

const box = () => screen.getByLabelText("Liitä kuva tai teksti lainasta") as HTMLTextAreaElement;
const button = (name: string) => screen.getByRole("button", { name });
const file = (name: string, type: string, content = "x") => new File([content], name, { type });
const pick = (f: File) => fireEvent.change(screen.getByLabelText("Kuva tai PDF lainasta"), { target: { files: [f] } });
/** Every field read from text is to check before saving: the household marks each one right. */
const confirmAll = () => screen.getAllByRole("checkbox").forEach((box) => fireEvent.click(box));
const open = (onSaved = vi.fn()) => {
  render(h(LoanIntake, { today: TODAY, onSaved }));
  return onSaved;
};

describe("Asetukset > Lainat: the box that reads a loan", () => {
  it("reads typed text into a form that shows the line each figure came from", async () => {
    open();
    expect((button("Lue lainan tiedot") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box(), { target: { value: LISTING } });
    fireEvent.click(button("Lue lainan tiedot"));
    expect(await screen.findByText("Luettu laina")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Löytyi 1 laina.");
    expect(screen.getByText("Tekstissä: Kuukausierä: 689,20 €")).toBeTruthy();
    expect(screen.getByDisplayValue("689,20")).toBeTruthy();
  });

  it("says so when the text holds no loan, and offers the manual route", () => {
    open();
    fireEvent.change(box(), { target: { value: "Tervehdys vain" } });
    fireEvent.click(button("Lue lainan tiedot"));
    expect(screen.getByRole("alert").textContent).toMatch(/Emme löytäneet tekstistä lainan tietoja/);
    expect(screen.queryByText("Luettu laina")).toBeNull();
  });

  it("reads text pasted into the empty box at once, but leaves a paste into typed text alone", () => {
    open();
    const data = (text: string) => ({ clipboardData: { files: [], getData: () => text } });
    fireEvent.paste(box(), data(LISTING));
    expect(screen.getByText("Luettu laina")).toBeTruthy();
    fireEvent.click(button("Hylkää"));
    fireEvent.change(box(), { target: { value: "jotain" } });
    fireEvent.paste(box(), data(LISTING));
    expect(screen.queryByText("Luettu laina")).toBeNull();
  });

  it("adds a form by hand with Lisää käsin, and Hylkää removes it", () => {
    open();
    fireEvent.click(button("Lisää käsin"));
    expect(screen.getByText("Uusi laina")).toBeTruthy();
    fireEvent.click(button("Hylkää"));
    expect(screen.queryByText("Uusi laina")).toBeNull();
  });

  it("saves a loan with its figures and tells the page its name", async () => {
    const seen = stubApi({ "POST /api/loans": { loan: { id: "l1" } } });
    const onSaved = open();
    fireEvent.change(box(), { target: { value: LISTING } });
    fireEvent.click(button("Lue lainan tiedot"));
    await screen.findByText("Luettu laina");
    fireEvent.change(screen.getByLabelText("Laji"), { target: { value: "mortgage" } });
    confirmAll();
    fireEvent.click(button("Tallenna"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(seen[0]).toMatchObject({ method: "POST", path: "/api/loans" });
    expect(seen[0]!.body).toMatchObject({ kind: "mortgage", paymentCents: 68920 });
    // the last form of a reading is done: the box is ready for the next loan
    expect(box().value).toBe("");
  });

  it("will not save while a read figure is still to check, and names it", async () => {
    const seen = stubApi({});
    open();
    fireEvent.change(box(), { target: { value: LISTING } });
    fireEvent.click(button("Lue lainan tiedot"));
    await screen.findByText("Luettu laina");
    fireEvent.change(screen.getByLabelText("Laji"), { target: { value: "mortgage" } });
    fireEvent.click(button("Tallenna"));
    expect((await screen.findByText(/^Tarkista vielä:/)).textContent).toMatch(/Merkitse kenttä oikeaksi/);
    expect(seen).toEqual([]);
  });

  it("keeps the form and shows the server's reason when saving fails", async () => {
    stubApi({ "POST /api/loans": failing(400, { error: "Saldo puuttuu." }) });
    const onSaved = open();
    fireEvent.change(box(), { target: { value: LISTING } });
    fireEvent.click(button("Lue lainan tiedot"));
    await screen.findByText("Luettu laina");
    fireEvent.change(screen.getByLabelText("Laji"), { target: { value: "mortgage" } });
    confirmAll();
    fireEvent.click(button("Tallenna"));
    expect(await screen.findByText("Saldo puuttuu.")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByText("Luettu laina")).toBeTruthy();
  });

  it("reads a text file, and refuses a file that is none of picture, PDF or text", async () => {
    open();
    pick(file("laina.txt", "text/plain", LISTING));
    expect(await screen.findByText("Luettu laina")).toBeTruthy();
    pick(file("laina.zip", "application/zip"));
    expect((await screen.findByRole("alert")).textContent).toBe("Tiedosto ei ole kuva, PDF eikä teksti.");
    expect(screen.queryByText("Luettu laina")).toBeNull();
  });

  it("refuses a file over 25 megabytes without reading it", async () => {
    open();
    const big = file("iso.png", "image/png");
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    pick(big);
    expect((await screen.findByRole("alert")).textContent).toMatch(/liian suuri/);
    expect(reader.picture).not.toHaveBeenCalled();
  });

  it("reads a picture through the reader, shows its progress and can end it with Keskeytä", async () => {
    reader.picture.mockImplementation((_f, onProgress: (p: unknown) => void, signal: AbortSignal) => {
      onProgress({ step: "read", share: 0.4 });
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new ReadAborted()));
      });
    });
    open();
    pick(file("laina.png", "image/png"));
    expect(await screen.findByText("Luemme kuvaa…")).toBeTruthy();
    expect(screen.getByText("40 %")).toBeTruthy();
    fireEvent.click(button("Keskeytä"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Lukeminen keskeytyi."));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the text of a read picture as a loan to check", async () => {
    reader.picture.mockResolvedValue(LISTING);
    open();
    pick(file("laina.png", "image/png"));
    expect(await screen.findByText("Luettu laina")).toBeTruthy();
    expect(box().value).toBe(LISTING);
  });

  it("tells what a failed PDF read means, and what a PDF with no text means", async () => {
    open();
    reader.pdf.mockRejectedValueOnce(new ReadError("PDF on salattu."));
    pick(file("a.pdf", "application/pdf"));
    expect((await screen.findByRole("alert")).textContent).toBe("PDF on salattu.");
    reader.pdf.mockResolvedValueOnce("1234 5678");
    pick(file("b.pdf", "application/pdf"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/pelkkä kuva/));
    reader.pdf.mockRejectedValueOnce(new Error("kaatui"));
    pick(file("c.pdf", "application/pdf"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Emme voineet lukea tiedostoa/));
    reader.pdf.mockResolvedValueOnce(LISTING);
    pick(file("d.pdf", "application/pdf"));
    expect(await screen.findByText("Luettu laina")).toBeTruthy();
  });

  it("reads a dropped file and text, and marks the box while something is over it", async () => {
    open();
    const zone = box().parentElement!;
    fireEvent.dragOver(zone);
    expect(zone.className).toContain("over");
    fireEvent.dragLeave(zone);
    expect(zone.className).not.toContain("over");
    fireEvent.drop(zone, { dataTransfer: { files: [file("laina.txt", "text/plain", LISTING)], getData: () => "" } });
    expect(await screen.findByText("Luettu laina")).toBeTruthy();
  });
});
