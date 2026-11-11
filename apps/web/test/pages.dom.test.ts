/**
 * The pages of the signed-in app on the real server with the demo household: a click or a typed word goes to the
 * server and the page shows what came back. Each test names what the household does there.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

const T = { timeout: 15000 };

const drills = () => [...document.querySelectorAll<HTMLButtonElement>("button.rt-drill")];

describe("Tapahtumat", () => {
  it("keeps the typed search word in the address", async () => {
    await startServer();
    await openApp("#/transactions", "Tapahtumat");
    await waitFor(() => expect(drills().length).toBeGreaterThan(10), T);
    // the toolbar is a chunk of its own, so the box arrives a moment after the rows
    fireEvent.change(await screen.findByPlaceholderText("Hae kauppiasta tai viestiä", {}, T), { target: { value: "Wolt" } });
    // the address follows the typed word after a pause, so a link keeps the search
    await waitFor(() => expect(window.location.hash).toBe("#/transactions?q=Wolt"), T);
  }, 60000);

  it("opens a row to its details and closes it again", async () => {
    await startServer();
    await openApp("#/transactions", "Tapahtumat");
    await waitFor(() => expect(drills().length).toBeGreaterThan(0), T);
    const first = drills()[0]!;
    fireEvent.click(first);
    await waitFor(() => expect(first.getAttribute("aria-expanded")).toBe("true"), T);
    fireEvent.click(first);
    await waitFor(() => expect(first.getAttribute("aria-expanded")).toBe("false"), T);
  }, 60000);

  it("groups the rows by merchant from the old address of the merchant list", async () => {
    await startServer();
    await openApp("#/transactions?view=merchants", "Tapahtumat");
    await waitFor(() => expect(window.location.hash).toBe("#/transactions?group=merchant"), T);
    await waitFor(() => expect(drills().length).toBeGreaterThan(10), T);
    // a group is a merchant with the count of its rows, where a day stood
    const heads = [...document.querySelectorAll("tr.rt-group th")].map((th) => th.textContent ?? "");
    expect(heads.length).toBeGreaterThan(1);
    expect(new Set(heads).size).toBe(heads.length);
    expect(heads.every((h) => !/\d{1,2}\.\d{1,2}\./.test(h))).toBe(true);
  }, 60000);

  it("lists the rules in Asetukset, and adds a rule", async () => {
    const server = await startServer();
    await openApp("#/settings/household#saannot", "Asetukset");
    await screen.findByRole("textbox", { name: "Hakusana" }, T);
    // each field shows its name above it, and no loose word stands between two fields
    const form = document.querySelector(".rule-form")!;
    expect([...form.querySelectorAll("label.field")].map((l) => l.firstChild?.textContent)).toEqual(["Kenttä", "Hakusana", "Kategoria"]);
    expect(form.textContent).not.toContain("kategoriaan");
    fireEvent.change(screen.getByRole("textbox", { name: "Hakusana" }), { target: { value: "Testikauppa" } });
    fireEvent.click(screen.getByRole("button", { name: "Lisää" }));
    await screen.findByRole("button", { name: "Poista sääntö: Testikauppa" }, T);
    expect(server.seen.some((s) => s.method === "POST" && s.path === "/api/rules")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Poista sääntö: Testikauppa" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Poista sääntö: Testikauppa" })).toBeNull(), T);
  }, 60000);
});

describe("Laskut", () => {
  it("refuses a bill with no name, then adds one by hand and says so", async () => {
    const server = await startServer();
    await openApp("#/bills", "Tulossa");
    fireEvent.click(await screen.findByRole("button", { name: "Lisää lasku" }, T));
    const form = (await screen.findByRole("heading", { name: "Lisää lasku" }, T)).closest("dialog")!.querySelector("form")!;
    fireEvent.submit(form);
    await screen.findByText("Anna laskulle nimi.");
    fireEvent.change(within(form).getByPlaceholderText("Ajoneuvovero"), { target: { value: "Ajoneuvovero" } });
    fireEvent.submit(form);
    await screen.findByText(/Anna summa euroina/);
    fireEvent.change(within(form).getByPlaceholderText("312,50"), { target: { value: "312,50" } });
    fireEvent.submit(form);
    await screen.findByText("Valitse eräpäivä.");
    fireEvent.change(within(form).getByLabelText("Eräpäivä"), { target: { value: "2026-11-20" } });
    fireEvent.submit(form);
    await waitFor(() => expect(document.querySelector("dialog.bill-dialog")).toBeNull(), T);
    expect(server.seen.find((s) => s.path === "/api/expected-bills" && s.method === "POST")!.body).toMatchObject({ name: "Ajoneuvovero", amountCents: 31250, dueDate: "2026-11-20", cadence: "yearly" });
    await waitFor(() => expect(document.body.textContent).toContain("Ajoneuvovero"), T);
  }, 60000);
});
