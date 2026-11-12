import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

const current = () => [...document.querySelectorAll("[aria-current]")].map((e) => e.textContent);

describe("Shell: a page carries its tab's name", () => {
  it("titles each page with the name of its tab", async () => {
    await startServer();
    await openApp("#/overview");
    await waitFor(() => expect(document.title).toBe("Nyt · Omatalous"));
    const { router } = await import("../src/router.tsx");
    await router.navigate({ href: "/bills" });
    await waitFor(() => expect(document.title).toBe("Tulossa · Omatalous"));
    await router.navigate({ href: "/reports" });
    await waitFor(() => expect(document.title).toBe("Kuukausi · Omatalous"));
    expect(current()).toEqual(["Kuukausi"]);
    await router.navigate({ href: "/reports?q=saldot" });
    await waitFor(() => expect(document.title).toBe("Lisää · Omatalous"));
    const tabs = screen.getByRole("navigation", { name: "Päävalikko" });
    expect(tabs.querySelector("[aria-current]")).toBeNull();
  }, 60000);

  it("links the rows list from the user menu", async () => {
    await startServer();
    await openApp("#/overview");
    const link = await screen.findByRole("link", { name: "Tapahtumat", hidden: true });
    expect(link.getAttribute("href")).toContain("/transactions");
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
