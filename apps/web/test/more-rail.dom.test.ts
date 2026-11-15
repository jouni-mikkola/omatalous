import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

describe("Raportit: the questions stand on every report page and mark the open one", () => {
  it("marks the question of a report that opens at a section of its page, and the first question on the bare address", async () => {
    await startServer();
    await openApp("#/reports?q=tulot#verovuosi");
    const rail = await screen.findByRole("navigation", { name: "Raportit" });
    await waitFor(() => expect(rail.querySelector("[aria-current]")?.textContent).toBe("Rahankäyttö"));
    // Tulot is a refinement of the first question, marked in the row under its name
    const refine = await screen.findByRole("navigation", { name: "Rahankäyttö" });
    expect(refine.querySelector("[aria-current=page]")?.textContent).toBe("Tulot");
    const { router } = await import("../src/router.tsx");
    await router.navigate({ href: "/reports?q=saldot" });
    await waitFor(() => expect(rail.querySelector("[aria-current]")?.textContent).toBe("Rahat ja velat"));
    expect(rail.querySelectorAll("[aria-current]")).toHaveLength(1);
    await waitFor(() => expect(document.querySelector("h2.q-title")?.textContent).toBe("Tilit ja saldot"));
    // the bare address, which the tab opens, shows the first report of the first question
    await router.navigate({ href: "/reports" });
    const bare = await screen.findByRole("navigation", { name: "Raportit" });
    await waitFor(() => expect(bare.querySelector("[aria-current]")?.textContent).toBe("Rahankäyttö"));
    await waitFor(() => expect(document.querySelector("h2.q-title")?.textContent).toBe("Rahankäyttö"));
    const names = [...bare.querySelectorAll("a")].map((a) => a.textContent);
    expect(names).not.toContain("Kuukausi");
    expect(names).toContain("Rahat ja velat");
    // the open question has several reports, so it is a mark and its first report is the first link of the row under it
    expect(bare.querySelector("a")?.getAttribute("href")).toBe("#/reports?q=saldot");
    expect(screen.getByRole("navigation", { name: "Rahankäyttö" }).querySelector("a")?.getAttribute("href")).toBe("#/reports?q=menot");
  }, 60000);
});
