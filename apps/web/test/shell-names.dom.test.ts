import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

const tabs = () => screen.getByRole("navigation", { name: "Päävalikko" });
const current = () => [...tabs().querySelectorAll("[aria-current]")].map((e) => e.textContent);

describe("Shell: a page carries its tab's name", () => {
  it("has the tabs Yhteenveto, Laskut, Tapahtumat and Raportit, and Tarkistettavat as a link beside them", async () => {
    await startServer();
    await openApp("#/overview");
    expect([...tabs().querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Yhteenveto", "Laskut", "Tapahtumat", "Raportit"]);
    const review = document.querySelector("header .review-link")!;
    expect(review.textContent).toContain("Tarkistettavat");
    expect(tabs().contains(review)).toBe(false);
  }, 60000);

  it("titles each page with the name of its tab", async () => {
    await startServer();
    await openApp("#/overview");
    await waitFor(() => expect(document.title).toBe("Yhteenveto · Omatalous"));
    expect(current()).toEqual(["Yhteenveto"]);
    const { router } = await import("../src/router.tsx");
    await router.navigate({ href: "/bills" });
    await waitFor(() => expect(document.title).toBe("Laskut · Omatalous"));
    await router.navigate({ href: "/transactions" });
    await waitFor(() => expect(document.title).toBe("Tapahtumat · Omatalous"));
    expect(current()).toEqual(["Tapahtumat"]);
    await router.navigate({ href: "/reports" });
    await waitFor(() => expect(document.title).toBe("Raportit · Omatalous"));
    // every report is under Raportit: its tab stays marked on a question page too
    await router.navigate({ href: "/reports?q=saldot" });
    await waitFor(() => expect(current()).toEqual(["Raportit"]));
    expect(document.title).toBe("Raportit · Omatalous");
  }, 60000);

  it("has no entry of the user menu for a page that has a tab", async () => {
    await startServer();
    await openApp("#/overview");
    const menu = document.querySelector(".user-menu .menu")!;
    const names = [...menu.querySelectorAll("a")].map((a) => a.textContent);
    expect(names).toEqual(["Asetukset"]);
  }, 60000);

  it("links the logo to Yhteenveto by its name", async () => {
    await startServer();
    await openApp("#/bills");
    const logo = screen.getByRole("link", { name: "Omatalous" });
    expect(logo.closest("header")).not.toBeNull();
    expect(logo.getAttribute("href")).toMatch(/\/overview$/);
  }, 60000);

  it("puts the page of an add-on module among the tabs at every width and not in the user menu", async () => {
    const { WEB_EXTENSIONS } = await import("../src/extensions.ts");
    WEB_EXTENSIONS.push({ id: "esimerkki", page: { label: "Esimerkki", component: () => null } });
    try {
      await startServer();
      await openApp("#/overview");
      const links = [...tabs().querySelectorAll("a")];
      expect(links.map((a) => a.textContent)).toEqual(["Yhteenveto", "Laskut", "Tapahtumat", "Raportit", "Esimerkki"]);
      expect(links.filter((a) => a.className)).toEqual([]);
      const menu = [...document.querySelectorAll(".user-menu .menu a")];
      expect(menu.map((a) => a.textContent)).toEqual(["Asetukset"]);
    } finally {
      WEB_EXTENSIONS.length = 0;
    }
  }, 60000);

  it("has no date and no line of the last fetch at the foot of the page", async () => {
    await startServer();
    await openApp("#/overview");
    await waitFor(() => expect(document.querySelector(".sheet-foot")?.textContent).toContain("Omatalous"));
    const parts = [...(document.querySelector(".sheet-foot")?.children ?? [])].map((e) => e.textContent ?? "");
    expect(parts.join(" ")).not.toMatch(/Tänään|Päivitetty|klo/);
    // the version is the one figure of the foot: no part of it ends in a day ("12.11." or "12.11.2026")
    expect(parts.filter((p) => /\d{1,2}\.\d{1,2}\.(\d{4})?$/.test(p))).toEqual([]);
    expect(parts[0]).toContain("Omatalous");
    expect(parts.filter((p) => /^(Oma|Koko talous)$/.test(p))).toEqual([]);
  }, 60000);
});
