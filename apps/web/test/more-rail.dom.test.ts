import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

describe("Raportit: the reports stand on every report page and mark the open one", () => {
  it("marks the report of an address that opens at a section of its page, and the first report on the bare address", async () => {
    await startServer();
    await openApp("#/reports?q=tulot#tulot");
    const rail = await screen.findByRole("navigation", { name: "Raportit" });
    await waitFor(() => expect(rail.querySelector("[aria-current]")?.textContent).toBe("Tulot ja menot"));
    const { router } = await import("../src/router.tsx");
    await router.navigate({ href: "/reports?q=menot" });
    await waitFor(() => expect(rail.querySelector("[aria-current]")?.textContent).toBe("Menot kategorioittain"));
    expect(rail.querySelectorAll("[aria-current]")).toHaveLength(1);
    await waitFor(() => expect(document.querySelector("h2.q-title")?.textContent).toBe("Menot kategorioittain"));
    // the bare address, which the tab opens, shows the first report
    await router.navigate({ href: "/reports" });
    const bare = await screen.findByRole("navigation", { name: "Raportit" });
    await waitFor(() => expect(bare.querySelector("[aria-current]")?.textContent).toBe("Tulot ja menot"));
    await waitFor(() => expect(document.querySelector("h2.q-title")?.textContent).toBe("Tulot ja menot"));
    // the page's name is for screen readers: the open tab above shows it already
    expect(document.querySelector("h2.q-title")?.classList.contains("sr-only")).toBe(true);
    const names = [...bare.querySelectorAll("a")].map((a) => a.textContent);
    expect(names).not.toContain("Kuukausi");
    expect(names).not.toContain("Varat ja velat");
    expect(bare.querySelector("a")?.getAttribute("href")).toBe("#/reports?q=tulot");
    expect(screen.getAllByRole("navigation", { name: "Raportit" })).toHaveLength(1);
  }, 60000);
});
