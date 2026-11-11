/**
 * A reload of Yhteenveto that fails while an answer is on screen is told: the error Notice stands above the figures of
 * the earlier fetch, and its button asks again. With no error there is no notice; a first load that fails is the card.
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
  queryClient.clear();
  const meta = await (await real("/api/meta")).json();
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Overview, { meta, scope: "own", onEmptyAction: async () => {}, onShowHousehold: () => {} }),
    ),
  );
  return { queryClient, fail: () => (down = true), mend: () => (down = false), asked: () => asked };
}

const figures = () => document.querySelector(".home-answer")?.textContent;

describe("Overview when a reload fails", () => {
  it("tells the error above the unchanged figures, and the button asks again", async () => {
    const k = await mount("later");
    await waitFor(() => expect(figures()).toBeTruthy(), T);
    const first = figures();
    expect(screen.queryByRole("alert"), "no notice with no error").toBeNull();

    k.fail();
    await k.queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/dashboard") });
    const notice = await screen.findByRole("alert", {}, T);
    expect(notice.textContent).toContain(SENTENCE);
    expect(figures(), "the figures stay").toBe(first);
    const answer = document.querySelector(".home-answer")!;
    expect(notice.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING, "the notice is above the figures").toBeTruthy();

    const before = k.asked();
    fireEvent.click(screen.getByRole("button", { name: "Yritä uudelleen" }));
    await waitFor(() => expect(k.asked()).toBeGreaterThan(before), T);

    k.mend();
    fireEvent.click(await screen.findByRole("button", { name: "Yritä uudelleen" }, T));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull(), T);
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
