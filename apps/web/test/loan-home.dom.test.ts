/**
 * Varat ja velat on the real server, the one place a loan is kept: Lisää laina in the head of Saldot adds one, the drill
 * of a loan's row in Lainat changes and removes it, and the line under the head of Saldot says what was done.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loanHash } from "../src/routes.ts";
import { openApp, startServer } from "./dom-kit.ts";

const T = { timeout: 15000 };
const CAR = { name: "Autolaina", kind: "car", balanceCents: 1_200_000, balanceDate: "2026-10-01" };

/** The line under the head of Saldot. */
const said = async (text: string) => expect((await screen.findByText(text, {}, T)).closest("[role=status]")).not.toBeNull();

describe("Lainat in Varat ja velat", () => {
  it("removes a saved loan after the question and says so", async () => {
    const server = await startServer();
    const { body } = await server.admin.call("POST", "/api/loans", CAR);
    await openApp(loanHash(body.loan.id));
    const remove = await screen.findByRole("button", { name: "Poista laina Autolaina" }, T);
    fireEvent.click(remove);
    const dialog = await screen.findByRole("dialog", { hidden: true });
    expect(dialog.textContent).toContain("Poista Autolaina?");
    expect(server.seen.some((s) => s.method === "DELETE" && s.path.startsWith("/api/loans/"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Poista laina", hidden: true }));
    await said("Laina poistettu");
    expect(server.seen.some((s) => s.method === "DELETE" && s.path.startsWith("/api/loans/"))).toBe(true);
  }, 60000);

  it("opens a loan for editing and closes the dialog on cancel", async () => {
    const server = await startServer();
    const { body } = await server.admin.call("POST", "/api/loans", CAR);
    await openApp(loanHash(body.loan.id));
    fireEvent.click(await screen.findByRole("button", { name: "Muokkaa lainaa Autolaina" }, T));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    expect(dialog.textContent).toContain("Muokkaa lainaa");
    // Escape in the dialog is the dialog's: the loan's row stays open with its buttons
    fireEvent.keyDown(within(dialog).getByLabelText("Nimi"), { key: "Escape" });
    expect(screen.getByRole("button", { name: "Muokkaa lainaa Autolaina" })).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Peruuta", hidden: true }));
    await waitFor(() => expect(document.querySelector("dialog.loan-dialog")).toBeNull(), T);
    expect(screen.getByRole("button", { name: "Muokkaa lainaa Autolaina" })).not.toBeNull();
  }, 60000);

  it("gives a viewer with no account Varat ja velat alone, where a loan is added, listed in Lainat and removed", async () => {
    await startServer({ demo: false });
    await openApp("#/reports");
    const rail = await screen.findByRole("navigation", { name: "Raportit" }, T);
    expect(within(rail).getAllByRole("link").map((a) => a.textContent)).toEqual(["Varat ja velat"]);
    expect(screen.queryByRole("heading", { name: "Lainat", level: 2 })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Lisää laina" }, T));
    const form = (await screen.findByRole("region", { name: "Uusi laina" }, T)) as HTMLElement;
    fireEvent.change(within(form).getByLabelText("Nimi"), { target: { value: "Autolaina" } });
    fireEvent.change(within(form).getByLabelText("Laji"), { target: { value: "car" } });
    fireEvent.change(within(form).getByLabelText("Lainaa jäljellä (€)"), { target: { value: "12 000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Tallenna" }));
    await said("Laina tallennettu");
    await screen.findByRole("heading", { name: "Lainat", level: 2 }, T);
    fireEvent.click(await screen.findByRole("button", { name: "Autolaina" }, T));
    fireEvent.click(await screen.findByRole("button", { name: "Poista laina Autolaina" }, T));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    fireEvent.click(within(dialog).getByRole("button", { name: "Poista laina", hidden: true }));
    // the last loan is gone with its panel, and the line in Saldot still says so
    await said("Laina poistettu.");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Lainat", level: 2 })).toBeNull(), T);
    expect(within(screen.getByRole("navigation", { name: "Raportit" })).getAllByRole("link")).toHaveLength(1);
  }, 60000);
});

describe("Lisää laina, the form that opens in place", () => {
  const focusIsIn = (selector: string) => expect(document.activeElement?.closest(selector), `focus on ${document.activeElement?.tagName}`).not.toBeNull();

  it("stands in the head of Saldot, moves the focus into the form on open and back to its button on Peruuta or Escape", async () => {
    await startServer();
    await openApp("#/reports?q=saldot");
    const opener = await screen.findByRole("button", { name: "Lisää laina" }, T);
    expect(opener.closest(".card-head")?.closest("#saldot"), "Lisää laina in the head of Saldot").not.toBeNull();
    fireEvent.click(opener);
    await waitFor(() => focusIsIn("form.loan-form"), T);
    expect(document.activeElement!.matches("input, select, textarea")).toBe(true);
    fireEvent.click(within(document.activeElement!.closest("form")!).getByRole("button", { name: "Peruuta" }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Lisää laina"), T);
    fireEvent.click(screen.getByRole("button", { name: "Lisää laina" }));
    await waitFor(() => focusIsIn("form.loan-form"), T);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Lisää laina"), T);
  }, 60000);

  it("leaves the form open on an Escape that belongs to a loan's dialog", async () => {
    const server = await startServer();
    const { body } = await server.admin.call("POST", "/api/loans", CAR);
    await openApp(loanHash(body.loan.id));
    fireEvent.click(await screen.findByRole("button", { name: "Lisää laina" }, T));
    await waitFor(() => focusIsIn("form.loan-form"), T);
    fireEvent.click(await screen.findByRole("button", { name: "Muokkaa lainaa Autolaina" }, T));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    fireEvent.keyDown(within(dialog).getAllByRole("textbox", { hidden: true })[0]!, { key: "Escape" });
    // the Escape is the dialog's: the new loan's form stays as it was
    expect(document.querySelector("section.loan-draft form.loan-form")).not.toBeNull();
  }, 60000);
});
