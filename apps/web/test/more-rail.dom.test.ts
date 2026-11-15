import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

describe("Raportit: the list of reports stands on every report page and marks the open one", () => {
  it("marks a report that opens at a section of its page, and the first report on the bare address", async () => {
    await startServer();
    await openApp("#/reports?q=tulot#verovuosi");
    const rail = await screen.findByRole("navigation", { name: "Raportit" });
    await waitFor(() => expect(rail.querySelector("[aria-current=page]")?.textContent).toBe("Tulot"));
    const { router } = await import("../src/router.tsx");
    await router.navigate({ href: "/reports?q=saldot" });
    await waitFor(() => expect(rail.querySelector("[aria-current=page]")?.textContent).toBe("Tilit ja saldot"));
    expect(rail.querySelectorAll("[aria-current]")).toHaveLength(1);
    // the bare address, which the tab opens, shows the first report: Kuukausi is gone from the list
    await router.navigate({ href: "/reports" });
    const bare = await screen.findByRole("navigation", { name: "Raportit" });
    await waitFor(() => expect(bare.querySelector("[aria-current=page]")?.textContent).toBe("Rahankäyttö"));
    const names = [...bare.querySelectorAll("a")].map((a) => a.textContent);
    expect(names).not.toContain("Kuukausi");
    expect(names).toContain("Tilit ja saldot");
    expect(bare.querySelector("a")?.getAttribute("href")).toBe("#/reports?q=menot");
  }, 60000);
});
