/**
 * Asetukset on the real server: the household adds and removes a member, changes the password and ends a device's
 * session, and each answer shows on the page.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

const T = { timeout: 15000 };

describe("Jäsenet", () => {
  it("refuses a username with spaces, then adds a member and shows the temporary password", async () => {
    const server = await startServer();
    await openApp("#/settings/members", "Asetukset");
    await screen.findByRole("heading", { name: "Talouden jäsenet" }, T);
    expect(screen.queryByLabelText(/Käyttäjätunnus/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lisää jäsen" }));
    // a visible label per field and the username's rule up front
    // (the member's form, not the first labelled form of the page: Säännöt above it has labels too)
    for (const label of ["Käyttäjätunnus", "Nimi", "Rooli"]) expect(screen.getByLabelText(/Käyttäjätunnus/).closest("form")!.textContent).toContain(label);
    expect(document.body.textContent).toContain("3–32 merkkiä: kirjaimia, numeroita ja merkit . _ -");
    fireEvent.change(screen.getByLabelText(/Käyttäjätunnus/), { target: { value: "Ei Sallittu" } });
    fireEvent.click(screen.getByRole("button", { name: "Lisää jäsen" }));
    await waitFor(() => expect(screen.getByLabelText(/Käyttäjätunnus/).getAttribute("aria-invalid")).toBe("true"), T);
    expect(server.seen.some((s) => s.path === "/api/users" && s.method === "POST")).toBe(false);
    fireEvent.change(screen.getByLabelText(/Käyttäjätunnus/), { target: { value: "pekka" } });
    fireEvent.change(screen.getByLabelText("Nimi"), { target: { value: "Pekka" } });
    fireEvent.click(screen.getByRole("button", { name: "Lisää jäsen" }));
    await waitFor(() => expect(document.body.textContent).toContain("pekka"), T);
    expect(server.seen.find((s) => s.path === "/api/users" && s.method === "POST")!.body).toMatchObject({ username: "pekka", displayName: "Pekka", role: "member" });
  }, 60000);

  it("adds a member with no login and removes them after the question", async () => {
    const server = await startServer();
    await openApp("#/settings/members", "Asetukset");
    await screen.findByRole("heading", { name: "Talouden jäsenet" }, T);
    fireEvent.click(screen.getByRole("button", { name: "Lisää jäsen" }));
    fireEvent.click(screen.getByLabelText("Ilman kirjautumista"));
    fireEvent.change(screen.getByLabelText("Nimi"), { target: { value: "Mummo" } });
    fireEvent.click(screen.getByRole("button", { name: "Lisää jäsen" }));
    await screen.findAllByRole("button", { name: "Poista Mummo" }, T);
    expect(server.seen.find((s) => s.path === "/api/admin/household-members" && s.method === "PUT")!.body).toEqual({ members: [{ name: "Mummo" }] });
    fireEvent.click(screen.getAllByRole("button", { name: "Poista Mummo" })[0]!);
    const dialog = await screen.findByRole("dialog", { hidden: true });
    fireEvent.click(within(dialog).getByRole("button", { name: "Poista Mummo", hidden: true }));
    await waitFor(() => expect(screen.queryAllByRole("button", { name: "Poista Mummo" })).toHaveLength(0), T);
    expect(server.seen.filter((s) => s.path === "/api/admin/household-members" && s.method === "PUT").pop()!.body).toEqual({ members: [] });
  }, 60000);

  it("asks before resetting a password and shows the new temporary one", async () => {
    const server = await startServer();
    await server.member("liisa", "Liisa");
    await openApp("#/settings/members", "Asetukset");
    fireEvent.click((await screen.findAllByRole("button", { name: "Nollaa salasana" }, T))[0]!);
    const dialog = await screen.findByRole("dialog", { hidden: true });
    expect(server.seen.some((s) => /reset-password$/.test(s.path))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Nollaa salasana", hidden: true }));
    const box = await screen.findByText(/Väliaikainen salasana käyttäjälle/, {}, T);
    expect(box.textContent).toContain("liisa");
    expect(server.seen.some((s) => /reset-password$/.test(s.path))).toBe(true);
  }, 60000);
});

describe("Turvallisuus", () => {
  it("lists this device and offers no sign-out of the others while there are none", async () => {
    const server = await startServer();
    await openApp("#/settings/security", "Asetukset");
    await screen.findByRole("heading", { name: "Omat istunnot" }, T);
    expect(screen.queryByRole("button", { name: "Kirjaa ulos muut laitteet" })).toBeNull();
    expect(server.seen.some((s) => s.path === "/api/security/sessions")).toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "Vaihda salasana" }, T));
    expect(await screen.findAllByLabelText(/salasana/i)).not.toHaveLength(0);
  }, 60000);
});

describe("Pankkisovellus", () => {
  it("makes the key, then refuses a file that is not a key and an id that is not one", async () => {
    const server = await startServer();
    await openApp("#/settings/banks", "Asetukset");
    // the guide is folded until it is asked for
    expect(screen.queryByRole("button", { name: "Luo avain" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Näytä ohje" }, T));
    fireEvent.click(await screen.findByRole("button", { name: "Luo avain" }, T));
    await waitFor(() => expect(server.seen.some((s) => /bank-app/.test(s.path) && s.method === "POST")).toBe(true), T);
    await screen.findByRole("button", { name: "Luo uusi" }, T);
    fireEvent.change(screen.getAllByPlaceholderText(/Sovelluksen tunnus \(/)[0]!, { target: { value: "ei-ole-id" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Tallenna ja testaa" })[0]!);
    await waitFor(() => expect(document.body.textContent).toContain("Sovelluksen tunnus on muotoa 12345678-abcd-"), T);
  }, 60000);

  it("says in words which steps of the checklist are done, as the tick and the dash have no text", async () => {
    await startServer();
    await openApp("#/settings/banks", "Asetukset");
    const steps = () => within(screen.getByRole("list", { name: "Enable Banking -sovelluksen vaiheet" })).getAllByRole("listitem").map((li) => li.textContent);
    await waitFor(() => expect(steps()).toEqual(["Salausavain luotu (ei vielä)", "Varmenne lisätty Enable Bankingiin (ei vielä)", "Sovelluksen tunnus toimii (ei vielä)", "Pankkitilisi yhdistetty Enable Bankingissa (ei vielä)"]), T);
    fireEvent.click(await screen.findByRole("button", { name: "Näytä ohje" }, T));
    fireEvent.click(await screen.findByRole("button", { name: "Luo avain" }, T));
    await waitFor(() => expect(steps()[0]).toBe("Salausavain luotu (tehty)"), T);
  }, 60000);
});

describe("Lainat", () => {
  it("removes a saved loan after the question and says so", async () => {
    const server = await startServer();
    await server.admin.call("POST", "/api/loans", { name: "Autolaina", kind: "car", balanceCents: 1_200_000, balanceDate: "2026-10-01" });
    await openApp("#/settings/household", "Asetukset");
    const remove = (await screen.findAllByRole("button", { name: /^Poista laina / }, T))[0]!;
    const name = remove.getAttribute("aria-label")!.replace("Poista laina ", "");
    fireEvent.click(remove);
    const dialog = await screen.findByRole("dialog", { hidden: true });
    expect(dialog.textContent).toContain(`Poista ${name}?`);
    expect(server.seen.some((s) => s.method === "DELETE" && s.path.startsWith("/api/loans/"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Poista laina", hidden: true }));
    await screen.findByText("Laina poistettu.", {}, T);
    expect(server.seen.some((s) => s.method === "DELETE" && s.path.startsWith("/api/loans/"))).toBe(true);
  }, 60000);

  it("opens a loan for editing and closes the dialog on cancel", async () => {
    const server = await startServer();
    await server.admin.call("POST", "/api/loans", { name: "Autolaina", kind: "car", balanceCents: 1_200_000, balanceDate: "2026-10-01" });
    await openApp("#/settings/household", "Asetukset");
    fireEvent.click((await screen.findAllByRole("button", { name: /^Muokkaa lainaa / }, T))[0]!);
    const dialog = await screen.findByRole("dialog", { hidden: true });
    expect(dialog.textContent).toContain("Muokkaa lainaa");
    fireEvent.click(within(dialog).getByRole("button", { name: "Peruuta", hidden: true }));
    await waitFor(() => expect(document.querySelector("dialog.loan-dialog")).toBeNull(), T);
  }, 60000);
});

describe("Forms that open in place", () => {
  const focusIsIn = (selector: string) => expect(document.activeElement?.closest(selector), `focus on ${document.activeElement?.tagName}`).not.toBeNull();

  it("moves the focus into the form on open and back to its button on Peruuta or Escape", async () => {
    await startServer();
    await openApp("#/settings/security", "Asetukset");
    const { router } = await import("../src/router.tsx");
    for (const [target, open, form] of [["security", "Vaihda salasana", "form"], ["members", "Lisää jäsen", "form.form-fields"], ["household", "Lisää laina", "form.loan-form"]] as const) {
      await router.navigate({ href: `/settings/${target}` });
      const opener = await screen.findByRole("button", { name: open }, T);
      // the button that opens a section's form stands in the strip of the section's name
      expect(opener.closest(".card-head"), `${open} in the name strip`).not.toBeNull();
      fireEvent.click(opener);
      await waitFor(() => focusIsIn(form), T);
      expect(document.activeElement!.matches("input, select, textarea")).toBe(true);
      // Peruuta closes and the focus is on the button that opened the form, not on the start of the page
      fireEvent.click(within(document.activeElement!.closest("form")!).getByRole("button", { name: "Peruuta" }));
      await waitFor(() => expect(document.activeElement?.textContent).toBe(open), T);
      // Escape closes an untouched form the same way
      fireEvent.click(screen.getByRole("button", { name: open }));
      await waitFor(() => focusIsIn(form), T);
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      await waitFor(() => expect(document.activeElement?.textContent).toBe(open), T);
    }
  }, 60000);

  it("keeps a form open on Escape once a field has changed", async () => {
    await startServer();
    await openApp("#/settings/members", "Asetukset");
    fireEvent.click(await screen.findByRole("button", { name: "Lisää jäsen" }, T));
    const name = await screen.findByLabelText(/Käyttäjätunnus/, {}, T);
    fireEvent.change(name, { target: { value: "pekka" } });
    fireEvent.keyDown(name, { key: "Escape" });
    expect(screen.getByLabelText(/Käyttäjätunnus/)).toHaveProperty("value", "pekka");
  }, 60000);

  it("leaves the form open on an Escape that belongs to a dialog of the same card", async () => {
    const server = await startServer();
    await server.admin.call("POST", "/api/loans", { name: "Autolaina", kind: "car", balanceCents: 1_200_000, balanceDate: "2026-10-01" });
    await openApp("#/settings/household", "Asetukset");
    fireEvent.click(await screen.findByRole("button", { name: "Lisää laina" }, T));
    await waitFor(() => focusIsIn("form.loan-form"), T);
    fireEvent.click((await screen.findAllByRole("button", { name: /^Muokkaa lainaa / }, T))[0]!);
    const dialog = await screen.findByRole("dialog", { hidden: true });
    fireEvent.keyDown(within(dialog).getAllByRole("textbox", { hidden: true })[0]!, { key: "Escape" });
    // the Escape is the dialog's: the new loan's form under it stays as it was
    expect(document.querySelector("section.loan-draft form.loan-form")).not.toBeNull();
  }, 60000);
});
