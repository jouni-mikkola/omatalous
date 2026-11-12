/**
 * A reload of Yhteenveto that fails while an answer is on screen: the shell's StaleAnswer line is the one place that says
 * so, with one retry button; the page adds no notice of its own, and the figures stay. A first load that fails is the card.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { startServer } from "./dom-kit.ts";

const T = { timeout: 15000 };
const SENTENCE = "Palvelin ei vastaa.";

async function mount(failFrom: "start" | "later") {
  await startServer();
  const real = globalThis.fetch;
  onTestFinished(() => void vi.unstubAllGlobals());
  let down = failFrom === "start";
  let asked = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (down && input.startsWith("/api/dashboard")) {
        asked++;
        return new Response(JSON.stringify({ error: SENTENCE }), { status: 500, headers: { "content-type": "application/json" } });
      }
      return real(input, init);
    }),
  );
  const { queryClient } = await import("../src/query-client.ts");
  const { Overview } = await import("../src/pages/Overview.tsx");
  const { StaleAnswer } = await import("../src/components/StaleAnswer.tsx");
  queryClient.clear();
  const meta = await (await real("/api/meta")).json();
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(StaleAnswer),
      createElement(Overview, { meta, scope: "own", onEmptyAction: async () => {}, onShowHousehold: () => {} }),
    ),
  );
  return { queryClient, fail: () => (down = true), mend: () => (down = false), asked: () => asked };
}

const figures = () => document.querySelector(".home-answer")?.textContent;

describe("Overview when a reload fails", () => {
  it("shows one retry line from the shell, and the figures stay", async () => {
    const k = await mount("later");
    await waitFor(() => expect(figures()).toBeTruthy(), T);
    const first = figures();
    expect(screen.queryByRole("alert"), "no alert with no error").toBeNull();
    // the table of the month's days has a live region of its own for its pager, read by a screen reader alone
    expect(screen.queryAllByRole("status").filter((e) => !e.classList.contains("sr-only")), "no notice with no error").toEqual([]);
    expect(screen.queryByText("Yritä uudelleen"), "no retry with no error").toBeNull();

    k.fail();
    await k.queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/dashboard") });
    await waitFor(() => expect(screen.getAllByText("Yritä uudelleen")).toHaveLength(1), T);
    expect(figures(), "the figures stay").toBe(first);

    const before = k.asked();
    fireEvent.click(screen.getByRole("button", { name: "Yritä uudelleen" }));
    await waitFor(() => expect(k.asked()).toBeGreaterThan(before), T);

    k.mend();
    fireEvent.click(await screen.findByRole("button", { name: "Yritä uudelleen" }, T));
    await waitFor(() => expect(screen.queryByText("Yritä uudelleen")).toBeNull(), T);
    expect(figures()).toBe(first);
  }, 60000);

  it("keeps the error card when the first load fails", async () => {
    await mount("start");
    const card = await screen.findByRole("alert", {}, T);
    expect(card.textContent).toContain("Emme saaneet tietoja haettua.");
    expect(card.textContent).toContain(SENTENCE);
    expect(document.querySelector(".home-answer"), "no figures").toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  }, 60000);
});
