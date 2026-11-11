/**
 * Tarkistettavat on the real server: one question at a time, an answer goes to the route of its source and the next
 * question comes, a skipped one waits.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Review } from "../src/pages/Review.tsx";
import type { ReviewItem } from "../src/pages/review-items.ts";
import type { Meta } from "../src/types.ts";
import { openApp, startServer, stubApi } from "./dom-kit.ts";

const T = { timeout: 15000 };
const question = () => (document.getElementById("review-q") ? document.querySelector(".review-item")!.textContent : null);
const choices = () => [...document.querySelectorAll<HTMLButtonElement>("button.review-choice")].filter((b) => !b.disabled);

describe("Tarkistettavat", () => {
  it("shows a question and no bar of its own, and an answer goes to the marks and brings the next", async () => {
    const server = await startServer();
    await openApp("#/review");
    await waitFor(() => expect(question()).not.toBeNull(), T);
    expect(screen.queryByRole("progressbar")).toBeNull();
    // the demo asks about subscriptions among others; pass the other kinds on until one is there
    for (let i = 0; i < 12 && !/käytössä\?/.test(document.getElementById("review-q")?.textContent ?? ""); i++) {
      const q = question();
      fireEvent.click(screen.getByRole("button", { name: "Ohita" }));
      await waitFor(() => expect(question()).not.toBe(q), T);
    }
    const asked = question();
    fireEvent.click(choices().find((b) => /Käytössä/.test(b.textContent ?? ""))!);
    await waitFor(() => expect(question()).not.toBe(asked), T);
    const put = server.seen.find((s) => s.method === "PUT" && s.path === "/api/marks")!;
    expect(put.body).toMatchObject({ mark: "in_use" });
  }, 90000);

  it("keeps a skipped question waiting and says how many are left when the batch ends", async () => {
    await startServer();
    await openApp("#/review");
    await waitFor(() => expect(question()).not.toBeNull(), T);
    const first = question();
    fireEvent.click(screen.getByRole("button", { name: "Ohita" }));
    await waitFor(() => expect(question()).not.toBe(first), T);
    for (let i = 0; i < 12 && document.getElementById("review-q"); i++) {
      const q = question();
      fireEvent.click(screen.getByRole("button", { name: "Ohita" }));
      await waitFor(() => expect(question()).not.toBe(q), T);
    }
    await screen.findByText("Ohitit loput", {}, T);
  }, 90000);

  it("says in the question's heading where the sitting is: a queue of three reads 2 / 3 after one answer", async () => {
    const seen = stubApi({ "PUT /api/marks": {} });
    const items: ReviewItem[] = ["a", "b", "c"].map((id) => ({ id, kind: "mortgage", cents: 0 }));
    const meta = { accounts: [{}], sharedAccounts: [], bank: { banks: [] } } as unknown as Meta;
    render(createElement(Review, { meta, queue: { data: { items }, error: null, reload: () => {} } }));
    const heading = () => screen.getByRole("heading", { level: 2 });
    expect(heading().textContent).toContain("Kysymys 1 / 3");
    fireEvent.click(screen.getByRole("button", { name: "Ei asuntolainaa" }));
    await waitFor(() => expect(heading().textContent).toContain("Kysymys 2 / 3"), T);
    expect(seen).toHaveLength(1);
    // once per question: the place is in the heading the focus moves to, and nowhere else in the card
    expect(document.activeElement).toBe(heading());
    expect(document.querySelector(".review-item")!.textContent!.match(/2 \/ 3/g)).toHaveLength(1);
  });
});
