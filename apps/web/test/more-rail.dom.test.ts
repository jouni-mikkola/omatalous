import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

describe("Lisää: the list marks the report that is open", () => {
  it("marks a report that opens at a section of its page", async () => {
    await startServer();
    await openApp("#/reports?q=tulot#verovuosi");
    const rail = await screen.findByRole("navigation", { name: "Lisää" });
    await waitFor(() => expect(rail.querySelector("[aria-current=page]")?.textContent).toBe("Verovuosi"));
    const { router } = await import("../src/router.tsx");
    await router.navigate({ href: "/reports?q=saldot" });
    await waitFor(() => expect(rail.querySelector("[aria-current=page]")?.textContent).toBe("Tilit ja saldot"));
    expect(rail.querySelectorAll("[aria-current]")).toHaveLength(1);
  }, 60000);
});
