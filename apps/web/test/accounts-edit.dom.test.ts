/**
 * Asetukset > Tilit on the real server: the form of an account opens in place of its Muokkaa, so the focus moves into
 * the form and comes back to Muokkaa when the form closes, instead of falling to the start of the page.
 */
import { readFileSync } from "node:fs";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

const T = { timeout: 15000 };

describe("Tilit: the form of an account", () => {
  it("takes the focus when it opens and gives it back to Muokkaa when it closes", async () => {
    await startServer();
    await openApp("#/settings/banks", "Asetukset");
    const edit = await screen.findByRole("button", { name: /^Muokkaa tiliä Käyttötili/ }, T);
    edit.focus();
    fireEvent.click(edit);
    const name = await screen.findByRole("textbox", { name: /^Tilin nimi/ }, T);
    expect(document.activeElement).toBe(name);
    fireEvent.click(screen.getByRole("button", { name: "Peruuta" }));
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Muokkaa tiliä Käyttötili/), T);
  }, 60000);

  it("says Tallennettu in the language of the page", () => {
    const src = readFileSync(new URL("../src/pages/settings/Accounts.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/text: "Tallennettu\."/);
  });
});
