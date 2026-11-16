/**
 * Tarkistettavat on the real server: one question at a time, an answer goes to the route of its source and the next
 * question comes, a skipped one waits.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { queryClient } from "../src/query-client.ts";
import { Review } from "../src/pages/Review.tsx";
import type { ReviewItem } from "../src/pages/review-items.ts";
import type { Meta } from "../src/types.ts";
import { failing, openApp, startServer, stubApi } from "./dom-kit.ts";

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

  it("answers a bill that did not come with Tulee vielä for its due day or Lopetettu for its series", async () => {
    const seen = stubApi({ "PUT /api/marks": {} });
    const bill = { kind: "bill", seriesId: "out:acc-1:Esimerkkisähkö", subject: "series:out:acc-1:Esimerkkisähkö", comingSubject: "question:bill-due:2026-09-01:out:acc-1:Esimerkkisähkö", merchant: "Esimerkkisähkö", dueDate: "2026-09-01", cents: 6420 };
    const items = [{ ...bill, id: "bill:1" }, { ...bill, id: "bill:2" }] as unknown as ReviewItem[];
    const meta = { accounts: [{}], sharedAccounts: [], bank: { banks: [] } } as unknown as Meta;
    render(createElement(Review, { meta, queue: { data: { items }, error: null, reload: () => {} } }));
    expect(choices().map((b) => b.textContent?.trim())).toEqual(["Tulee vielä", "Lopetettu"]);
    fireEvent.click(screen.getByRole("button", { name: "Tulee vielä" }));
    await waitFor(() => expect(seen).toHaveLength(1), T);
    expect(seen[0]!.body).toEqual({ subject: "question:bill-due:2026-09-01:out:acc-1:Esimerkkisähkö", mark: "in_use" });
    fireEvent.click(await screen.findByRole("button", { name: "Lopetettu" }, T));
    await waitFor(() => expect(seen).toHaveLength(2), T);
    expect(seen[1]!.body).toEqual({ subject: "series:out:acc-1:Esimerkkisähkö", mark: "cancelled" });
  });

  it("asks a saved loan for its missing fact, opens that loan's own form with that field alone and goes once the loan is saved", async () => {
    queryClient.clear();
    const loan = { id: "loan-7", name: "Asuntolaina", lender: null, kind: "mortgage", grantedCents: null, balanceCents: 15_000_000, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, endDate: null, limitCents: null, seriesKey: null };
    const other = { ...loan, id: "loan-8", name: "Toinen laina" };
    const seen = stubApi({ "GET /api/loans": { loans: [other, loan] }, "PUT /api/loans/loan-7": { loan }, "PUT /api/marks": {} });
    const item = { id: "loan_terms:loan-7", kind: "loan_terms", cents: 0, loanId: "loan-7", accountId: null, name: "Asuntolaina", owedCents: 15_000_000, balanceDate: "2026-10-01", missing: "rate", subject: "question:loan-terms:loan-7" } as unknown as ReviewItem;
    const meta = { accounts: [], sharedAccounts: [], bank: { banks: [] }, today: "2026-10-09" } as unknown as Meta;
    render(createElement(Review, { meta, queue: { data: { items: [item] }, error: null, reload: () => {} } }));
    expect(document.querySelector(".review-item")!.textContent).toContain("Mikä on lainan kokonaiskorko?");
    expect(choices().map((b) => b.textContent?.trim())).toEqual(["Täydennä laina", "Älä muistuta tästä enää"]);
    fireEvent.click(screen.getByRole("button", { name: "Täydennä laina" }));
    // the missing fact alone is asked; the rest of the form is behind one button
    await screen.findByLabelText(/^Kokonaiskorko/, {}, T);
    expect(screen.queryByLabelText(/^Maksuerä/)).toBeNull();
    expect(screen.queryByLabelText(/^Lainaa jäljellä/)).toBeNull();
    expect(screen.queryByLabelText("Nimi")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Näytä kaikki kentät" }));
    // the form is the one of the loan the item names, not another saved loan
    expect((await screen.findByLabelText("Nimi", {}, T) as HTMLInputElement).value).toBe("Asuntolaina");
    expect(screen.getByLabelText(/^Maksuerä/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "PUT" && s.path === "/api/loans/loan-7")).toBe(true), T);
  });

  it("asks only the fact that is missing: the field of each answer, and a connected card's form is the one of a new loan linked to it", async () => {
    queryClient.clear();
    const card = { id: "card-1", name: "Luottokortti", type: "credit_card", balanceCents: -50_000, balanceAt: "2026-10-08", creditLimitCents: 200_000 };
    const seen = stubApi({ "GET /api/loans": { loans: [] }, "POST /api/loans": { loan: { id: "loan-9" } }, "PUT /api/marks": {} });
    const item = { id: "loan_terms:account:card-1", kind: "loan_terms", cents: 0, loanId: null, accountId: "card-1", name: "Luottokortti", owedCents: 50_000, balanceDate: "2026-10-08", missing: "rate", subject: "question:loan-terms:account:card-1" } as unknown as ReviewItem;
    const meta = { accounts: [card], sharedAccounts: [], bank: { banks: [] }, today: "2026-10-09" } as unknown as Meta;
    render(createElement(Review, { meta, queue: { data: { items: [item] }, error: null, reload: () => {} } }));
    expect(document.querySelector(".review-item")!.textContent).toContain("Mikä on kortin kokonaiskorko?");
    expect(choices().map((b) => b.textContent?.trim())).toEqual(["Täydennä kortin ehdot", "Älä muistuta tästä enää"]);
    fireEvent.click(screen.getByRole("button", { name: "Täydennä kortin ehdot" }));
    const rate = await screen.findByLabelText(/^Kokonaiskorko/, {}, T);
    // the form opens at its first field
    await waitFor(() => expect(document.activeElement).toBe(rate), T);
    fireEvent.change(rate, { target: { value: "19" } });
    expect(screen.queryByLabelText("Nimi")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "POST" && s.path === "/api/loans")).toBe(true), T);
    const post = seen.find((s) => s.method === "POST" && s.path === "/api/loans")!;
    expect(post.body).toMatchObject({ name: "Luottokortti", kind: "card", accountId: "card-1", balanceCents: 50_000, limitCents: 200_000, rateBp: 1_900 });
  });

  it("shows the error of the other forms when the loans cannot be read", async () => {
    queryClient.clear();
    stubApi({ "GET /api/loans": failing(500, { error: "Lainoja ei voitu lukea." }) });
    const item = { id: "loan_terms:loan-7", kind: "loan_terms", cents: 0, loanId: "loan-7", accountId: null, name: "Asuntolaina", owedCents: 15_000_000, balanceDate: "2026-10-01", missing: "payment", subject: "question:loan-terms:loan-7" } as unknown as ReviewItem;
    const meta = { accounts: [], sharedAccounts: [], bank: { banks: [] }, today: "2026-10-09" } as unknown as Meta;
    render(createElement(Review, { meta, queue: { data: { items: [item] }, error: null, reload: () => {} } }));
    fireEvent.click(screen.getByRole("button", { name: "Täydennä laina" }));
    expect((await screen.findByRole("alert", {}, T)).textContent).toContain("Lainoja ei voitu lukea.");
  });

  it("sets a saved loan's question aside with the mark of the item", async () => {
    const seen = stubApi({ "PUT /api/marks": {} });
    const item = { id: "loan_terms:loan-7", kind: "loan_terms", cents: 0, loanId: "loan-7", accountId: null, name: "Asuntolaina", owedCents: 15_000_000, balanceDate: "2026-10-01", missing: "payment", subject: "question:loan-terms:loan-7" } as unknown as ReviewItem;
    const meta = { accounts: [], sharedAccounts: [], bank: { banks: [] }, today: "2026-10-09" } as unknown as Meta;
    render(createElement(Review, { meta, queue: { data: { items: [item] }, error: null, reload: () => {} } }));
    fireEvent.click(screen.getByRole("button", { name: "Älä muistuta tästä enää" }));
    await waitFor(() => expect(seen).toHaveLength(1), T);
    expect(seen[0]!.body).toEqual({ subject: "question:loan-terms:loan-7", mark: "dismissed" });
  });

  it("has the focus on the next question's heading in the same moment its text shows", async () => {
    stubApi({ "PUT /api/marks": {} });
    const items: ReviewItem[] = ["a", "b", "c"].map((id) => ({ id, kind: "mortgage", cents: 0 }));
    const meta = { accounts: [{}], sharedAccounts: [], bank: { banks: [] } } as unknown as Meta;
    render(createElement(Review, { meta, queue: { data: { items }, error: null, reload: () => {} } }));
    // watch the page itself: the first change that shows 2 / 3 must already have the focus on the heading
    let focusWhenShown: boolean | null = null;
    const watch = new MutationObserver(() => {
      const h = document.getElementById("review-q");
      if (focusWhenShown === null && h?.textContent?.includes("Kysymys 2 / 3")) focusWhenShown = document.activeElement === h;
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    fireEvent.click(screen.getByRole("button", { name: "Ei asuntolainaa" }));
    await waitFor(() => expect(focusWhenShown).not.toBeNull(), T);
    watch.disconnect();
    expect(focusWhenShown).toBe(true);
  });
});
