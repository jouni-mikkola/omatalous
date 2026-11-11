/**
 * A reload that fails leaves the answer before it on the page (design section 4, error): the view still reads the
 * first answer, and one line says what failed, from when the shown answer is and how to ask again.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";
import { dateTime } from "../src/format.ts";
import { markAllCurrent, markKept } from "../src/offline.ts";
import { queryClient } from "../src/query-client.ts";

const T = { timeout: 15000 };
const SENTENCE = "Palvelin ei vastaa.";

describe("a view whose second load fails", () => {
  it("still reads the first answer, with its time and the one line, and the line goes when a load succeeds", async () => {
    // only the clock of `Date` is set: the answer comes at `t0` and the failure five minutes later, so the two times read apart
    const t0 = new Date();
    t0.setSeconds(0, 0);
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    onTestFinished(() => void vi.useRealTimers());
    await startServer();
    await openApp("#/overview");
    const answer = await waitFor(() => {
      const el = document.querySelector(".home-answer");
      expect(el?.textContent).toBeTruthy();
      return el!;
    }, T);
    const first = answer.textContent;
    const dashboard = queryClient.getQueryCache().getAll().find((q) => String(q.queryKey[0]).startsWith("/api/dashboard"))!;
    expect(dashboard.state.dataUpdatedAt).toBe(t0.getTime());
    const later = new Date(t0.getTime() + 5 * 60_000);
    vi.setSystemTime(later);
    expect(document.querySelector(".stale-answer"), "no line over a fresh answer").toBeNull();

    // the server fails every dashboard request from here on
    const real = globalThis.fetch;
    let down = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) =>
        down && input.startsWith("/api/dashboard")
          ? new Response(JSON.stringify({ error: SENTENCE }), { status: 500, headers: { "content-type": "application/json" } })
          : real(input, init),
      ),
    );
    await queryClient.invalidateQueries({ queryKey: dashboard.queryKey, exact: true });

    const line = await waitFor(() => {
      const el = document.querySelector(".stale-answer");
      expect(el).not.toBeNull();
      return el!;
    }, T);
    expect(document.querySelectorAll(".stale-answer"), "one line").toHaveLength(1);
    expect(line.textContent).toContain(SENTENCE);
    expect(line.textContent, "the time of the answer that stays").toContain(`Tulokset ajalta ${dateTime(t0.toISOString())}.`);
    expect(line.textContent, "not the time of the failure").not.toContain(dateTime(later.toISOString()));
    expect(document.querySelector(".home-answer")?.textContent, "the first answer stays").toBe(first);
    expect(screen.queryByText("Emme saaneet tietoja haettua. Yritä uudelleen."), "the answer is not replaced by the failure").toBeNull();

    // while the shell says the server cannot be reached and gives the time of the kept figures, that is the one line
    act(() => markKept("/api/dashboard", t0.toISOString()));
    expect(document.querySelector(".stale-answer"), "no second line beside the shell's").toBeNull();
    act(() => markAllCurrent());
    expect(document.querySelectorAll(".stale-answer")).toHaveLength(1);

    // what to do: the button asks again, and a load that succeeds takes the line away
    down = false;
    fireEvent.click(screen.getByRole("button", { name: "Yritä uudelleen" }));
    await waitFor(() => expect(document.querySelector(".stale-answer")).toBeNull(), T);
    expect(document.querySelector(".home-answer")?.textContent).toBe(first);
  }, 60000);
});
