/**
 * A page that fails: the text of an exception is not shown (docs/UI_STYLE.md). The member reads the catalogue's sentence
 * in their language with the retry button, and only the server's own sentence (an ApiError) is shown as it is.
 */
import { screen } from "@testing-library/react";
import { messageIn } from "@banking/core";
import { describe, expect, it, vi } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

const T = { timeout: 15000 };
const THROWN = "Failed to fetch dynamically imported module";
const OWN = "Pankki ei vastaa juuri nyt.";

// two pages that throw as they are drawn: one as a browser does when a chunk is gone, one with the server's sentence
vi.mock("../src/views/ReportsView.tsx", () => ({
  ReportsView: () => {
    throw new TypeError(THROWN);
  },
}));
vi.mock("../src/views/BillsView.tsx", async () => {
  const { ApiError } = await import("../src/api.ts");
  return {
    BillsView: () => {
      throw new ApiError(OWN, 502);
    },
  };
});

describe("a failed page", () => {
  it("shows the catalogue's sentence with the retry button, not the text of the exception", async () => {
    // React logs the caught error; the log is not what the member sees
    vi.spyOn(console, "error").mockImplementation(() => {});
    await startServer();
    await openApp("#/reports");
    const sentence = await screen.findByText(messageIn("fi", "app.request_failed"), {}, T);
    expect(sentence.closest('[data-tone="error"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: messageIn("fi", "load.retry") })).toBeTruthy();
    expect(document.body.textContent).not.toContain(THROWN);
  }, 60000);

  it("keeps the sentence of an ApiError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await startServer();
    await openApp("#/bills");
    await screen.findByText(OWN, {}, T);
    expect(screen.getByRole("button", { name: messageIn("fi", "load.retry") })).toBeTruthy();
    expect(document.body.textContent).not.toContain(messageIn("fi", "app.request_failed"));
  }, 60000);
});
