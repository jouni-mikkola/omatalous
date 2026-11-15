/**
 * The card statement view: a save that fails with a fault of the page itself reads as the catalogue's sentence, not as
 * the text of the exception.
 */
import { messageIn } from "@banking/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardStatement } from "../src/components/cards/CardStatement.tsx";
import { language } from "../src/format.ts";

const THROWN = "Cannot read properties of undefined (reading 'rows')";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("Erittele ostot", () => {
  it("says a failed save in the catalogue's sentence, not in the text of the exception", async () => {
    // the answer breaks as it is read, past the fetch itself: the save throws a TypeError
    const answer = { headers: { get: () => { throw new TypeError(THROWN); } } };
    globalThis.fetch = (async () => answer) as unknown as typeof fetch;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const bill = { id: "b1", bookingDate: "2026-03-15", amountCents: -1250, merchant: "Luottokunta" };
    const saved = { billId: "b1", periodFrom: "2026-02-13", periodTo: "2026-03-15", read: false, explainedCents: 1250, rows: [{ day: "2026-03-01", cents: 1250, text: "Kauppa" }] };
    render(createElement(CardStatement, { bill, saved, onClose: () => {}, onChanged: () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "Tallenna", hidden: true }));
    const alert = await screen.findByRole("alert", { hidden: true });
    expect(alert.textContent).toBe(messageIn(language(), "app.request_failed"));
    expect(document.body.textContent).not.toContain(THROWN);
    // the fault is not lost: the console keeps the exception
    expect(logged.mock.calls.some(([e]) => e instanceof TypeError && e.message === THROWN)).toBe(true);
  });
});
