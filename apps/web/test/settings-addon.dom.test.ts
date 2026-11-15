/**
 * Asetukset on the real server with an add-on module loaded in the page: its card and the add-on's own card (code,
 * version, state) are on the tab Lisäosa, and neither is left on Talous or Palvelin ja ylläpito. Without a module there
 * is no such tab and the code card stays on Palvelin ja ylläpito. The module is made up in the test.
 */
import { screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { WEB_EXTENSIONS } from "../src/extensions.ts";
import { router } from "../src/router.tsx";
import { openApp, startServer } from "./dom-kit.ts";

const T = { timeout: 15000 };

const ExampleCard = () => createElement("section", { className: "card", id: "esimerkki" }, createElement("h2", null, "Esimerkin asetukset"));

afterEach(() => {
  WEB_EXTENSIONS.splice(0);
});

const tabs = () => screen.getByRole("navigation", { name: "Asetukset" }).textContent;
const cardHeadings = () => [...document.querySelectorAll(".card-stack h2")].map((h) => h.textContent);

describe("Asetukset > Lisäosa", () => {
  it("holds the module's card and the add-on's card while a module is loaded", async () => {
    await startServer();
    WEB_EXTENSIONS.push({ id: "example", settingsCard: ExampleCard, settingsAnchor: "esimerkki", page: { label: "Esimerkki", component: () => null } });
    await openApp("#/settings/addon", "Asetukset");
    await waitFor(() => expect(cardHeadings()).toEqual(["Esimerkin asetukset", "Lisäosa"]), T);
    expect(tabs()).toMatch(/Palvelin ja ylläpitoLisäosa$/);
    await router.navigate({ href: "/settings/household" });
    await screen.findByRole("heading", { name: "Lainat" }, T);
    expect(cardHeadings()).not.toContain("Esimerkin asetukset");
    await router.navigate({ href: "/settings/server" });
    await screen.findByRole("heading", { name: "Ylläpito" }, T);
    expect(cardHeadings()).not.toContain("Lisäosa");
  }, 60000);

  it("is no tab without a module, and the add-on's card is on Palvelin ja ylläpito", async () => {
    await startServer();
    await openApp("#/settings/server", "Asetukset");
    await waitFor(() => expect(cardHeadings()).toContain("Lisäosa"), T);
    expect(tabs()).not.toContain("Lisäosa");
  }, 60000);
});
