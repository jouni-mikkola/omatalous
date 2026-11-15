/**
 * "Change undone." on a phone leaves by itself after 8 seconds, as the line about the change does; on a wide screen it stays.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

const T = { timeout: 15000 };

function screenWidth(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && query.includes("max-width"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

/** Changes the category of the first row, undoes it, and returns once the undone line is up (timers faked from the undo on). */
async function undoOneChange() {
  await startServer();
  await openApp("#/transactions", "Tapahtumat");
  fireEvent.click((await screen.findAllByRole("button", { name: /^Avaa .*: 12 kuukautta$/ }, T))[0]!);
  fireEvent.click(await screen.findByRole("button", { name: /^Muuta: / }, T));
  fireEvent.click(await screen.findByRole("menuitem", { name: /^Kategoria: / }, T));
  const options = await screen.findAllByRole("option", {}, T);
  const pick = options.find((o) => o.getAttribute("aria-selected") !== "true")!;
  fireEvent.click(pick);
  const undo = await screen.findByRole("button", { name: "Kumoa" }, T);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.click(undo);
  await vi.waitFor(() => expect(screen.getByText("Kumosimme muutoksen.")).toBeTruthy(), T);
}

describe("Kumottu muutos", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves a phone by itself after 8 seconds", async () => {
    screenWidth(true);
    await undoOneChange();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(screen.queryByText("Kumosimme muutoksen.")).toBeNull();
  }, 60000);

  it("stays on a wide screen", async () => {
    screenWidth(false);
    await undoOneChange();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(screen.queryByText("Kumosimme muutoksen.")).not.toBeNull();
  }, 60000);
});
