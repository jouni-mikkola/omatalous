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
});
