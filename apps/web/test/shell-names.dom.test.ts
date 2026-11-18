import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

const tabs = () => screen.getByRole("navigation", { name: "Päävalikko" });
const current = () => [...tabs().querySelectorAll("[aria-current]")].map((e) => e.textContent);

describe("Shell: a page carries its tab's name", () => {
  it("has the tabs Yhteenveto, Laskut, Tapahtumat and Raportit, and Tarkistettavat as a link beside them", async () => {
    await startServer();
    // the header's link shows while something is open and on its own page
    await openApp("#/review");
    expect([...tabs().querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Yhteenveto", "Laskut", "Tapahtumat", "Raportit"]);
    const review = document.querySelector("header .review-link")!;
    expect(review.textContent).toContain("Tarkistettavat");
    expect(tabs().contains(review)).toBe(false);
  }, 60000);

  it("shows the Tarkistettavat link with its count while something is open", async () => {
    await startServer();
    await openApp("#/overview");
    await waitFor(() => expect(document.querySelector("header .review-link .nav-count")).not.toBeNull(), { timeout: 15000 });
  }, 60000);

  it("has no Tarkistettavat link while there is no data and nothing is open", async () => {
    const server = await startServer({ demo: false });
    await openApp("#/overview");
    // the link shows while the count loads: wait until the server has answered it, then until the link is gone
    await waitFor(() => expect(server.seen.some((s) => s.path === "/api/review/count")).toBe(true), { timeout: 15000 });
    await waitFor(() => expect(document.querySelector("header .review-link")).toBeNull(), { timeout: 15000 });
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
    await waitFor(() => expect(document.title).toMatch(/^Raportit(: .+)? · Omatalous$/));
    // every report is under Raportit: its tab stays marked on a question page too, and the title names the question
    await router.navigate({ href: "/reports?q=saldot" });
    await waitFor(() => expect(current()).toEqual(["Raportit"]));
    await waitFor(() => expect(document.title).toBe("Raportit: Varat ja velat · Omatalous"));
    // Asetukset names its open section
    await router.navigate({ href: "/settings/security" });
    await waitFor(() => expect(document.title).toBe("Asetukset: Turvallisuus · Omatalous"));
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
      expect(links.filter((a) => a.classList.contains("nav-wide-only"))).toEqual([]);
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
    // the version is in the foot and in Palvelin ja ylläpito, not a third time in the menu of the user
    expect(document.querySelector(".user-menu .menu")?.textContent).not.toContain("Omatalous");
    expect(parts.filter((p) => /^(Oma|Koko talous)$/.test(p))).toEqual([]);
  }, 60000);

  it("draws the title of a page that has no heading of its own, and keeps the hidden one on the pages that have", async () => {
    const { WEB_EXTENSIONS } = await import("../src/extensions.ts");
    WEB_EXTENSIONS.push({ id: "esimerkki", page: { label: "Esimerkki", component: () => null } });
    try {
      await startServer();
      await openApp("#/overview");
      const { router } = await import("../src/router.tsx");
      const pages: [string, string, boolean][] = [
        ["/overview", "Yhteenveto", false],
        ["/bills", "Laskut", false],
        ["/transactions", "Tapahtumat", false],
        ["/reports", "Raportit", false],
        ["/review", "Tarkistettavat", false],
        ["/settings/security", "Asetukset", true],
        ["/esimerkki", "Esimerkki", true],
      ];
      for (const [href, name, drawn] of pages) {
        await router.navigate({ href });
        await waitFor(() => expect(document.title).toMatch(new RegExp(`^${name}`)));
        const h1 = screen.getByRole("heading", { level: 1 });
        expect(h1.classList.contains("page-title"), href).toBe(drawn);
        expect(h1.classList.contains("sr-only"), href).toBe(!drawn);
      }
      // Asetukset is drawn as its name alone; the section is in the tab row and in the name a screen reader reads
      await router.navigate({ href: "/settings/security" });
      await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Asetukset: Turvallisuus" }).textContent).toBe("Asetukset"));
    } finally {
      WEB_EXTENSIONS.length = 0;
    }
  }, 90000);

  it("offers Oma and Koko talous on the four pages and on none that does not read the scope", async () => {
    await startServer();
    // the viewer has half of an account: the household has a view of its own, so the switch is there where it means something
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const res = await real(input, init);
      if (new URL(input, "http://localhost").pathname !== "/api/meta") return res;
      const meta = (await res.json()) as { accounts: object[] };
      meta.accounts = meta.accounts.map((a, i) => (i === 0 ? { ...a, part: { from: 0, to: 1, of: 2 } } : a));
      return new Response(JSON.stringify(meta), { status: res.status, headers: { "content-type": "application/json" } });
    });
    await openApp("#/overview");
    const { router } = await import("../src/router.tsx");
    const switchOn = (href: string, title: RegExp, shown: boolean) =>
      waitFor(async () => {
        await router.navigate({ href });
        expect(document.title).toMatch(title);
        expect(document.querySelector(".topbar .scope-toggle") !== null, href).toBe(shown);
      });
    await switchOn("/overview", /^Yhteenveto/, true);
    await switchOn("/bills", /^Laskut/, true);
    await switchOn("/transactions", /^Tapahtumat/, true);
    await switchOn("/reports", /^Raportit/, true);
    await switchOn("/review", /^Tarkistettavat/, false);
    await switchOn("/settings/security", /^Asetukset/, false);
  }, 90000);
});
