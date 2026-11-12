import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

describe("Raportit: the list of reports stands on every report page and marks the open one", () => {
  it("marks a report that opens at a section of its page, and Kuukausi on the month", async () => {
    await startServer();
    await openApp("#/reports?q=tulot#verovuosi");
    const rail = await screen.findByRole("navigation", { name: "Raportit" });
    await waitFor(() => expect(rail.querySelector("[aria-current=page]")?.textContent).toBe("Tulot"));
    const { router } = await import("../src/router.tsx");
    await router.navigate({ href: "/reports?q=saldot" });
    await waitFor(() => expect(rail.querySelector("[aria-current=page]")?.textContent).toBe("Tilit ja saldot"));
    expect(rail.querySelectorAll("[aria-current]")).toHaveLength(1);
    // the month had no list on main: the other reports were behind Lisää of the user menu
    await router.navigate({ href: "/reports" });
    const onMonth = await screen.findByRole("navigation", { name: "Raportit" });
    await waitFor(() => expect(onMonth.querySelector("[aria-current=page]")?.textContent).toBe("Kuukausi"));
    const names = [...onMonth.querySelectorAll("a")].map((a) => a.textContent);
    expect(names[0]).toBe("Kuukausi");
    expect(names).toContain("Tilit ja saldot");
    expect(onMonth.querySelector("a")?.getAttribute("href")).toBe("#/reports");
  }, 60000);
});
