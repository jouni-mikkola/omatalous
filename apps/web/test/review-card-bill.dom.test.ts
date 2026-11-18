/**
 * Tarkistettavat's question of a card the household pays the bills of and has not connected: connect it, enter what it
 * owes in the loan form, or say it is already saved under Lainat; and the question of a loan's kind, whose answer is followed at once by the form that asks the balance.
 * Made-up issuer and sums.
 */
import type { Loan } from "@banking/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { queryClient } from "../src/query-client.ts";
import { Review } from "../src/pages/Review.tsx";
import type { ReviewItem } from "../src/pages/review-items.ts";
import type { Meta } from "../src/types.ts";
import { failing, stubApi } from "./dom-kit.ts";

const T = { timeout: 15000 };
const meta = { accounts: [], sharedAccounts: [], bank: { banks: [] }, today: "2026-10-09" } as unknown as Meta;
const show = (item: unknown, reload = () => {}) => render(createElement(Review, { meta, queue: { data: { items: [item as ReviewItem] }, error: null, reload } }));

describe("the question of a card that is not connected", () => {
  const card = { id: "card_bill:out:chk:Esimerkkikortti", kind: "card_bill", cents: 552_000, key: "out:chk:Esimerkkikortti", payee: "Esimerkkikortti", paymentCents: 46_000, months: 7, firstDate: "2026-03-12", lastDate: "2026-09-12", savedCards: [] };

  it("offers to connect the card or to enter what it owes, and the second opens the loan form asking the balance", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [] } });
    show(card);
    expect(document.querySelector(".review-item")!.textContent).toContain("Maksat kortin laskuja, mutta korttia ei ole yhdistetty");
    expect(screen.getByRole("link", { name: "Yhdistä kortti" }).getAttribute("href")).toContain("settings/banks");
    expect(seen).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Kirjaa kortin velka" }));
    await screen.findByLabelText(/Lainaa jäljellä/, {}, T);
    // nothing is saved until the form is: the item is still the question
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /api/loans"]);
  });
});

describe("the question of a card that is saved under Lainat with no link", () => {
  const card = { id: "card_bill:out:chk:Esimerkkikortti", kind: "card_bill", cents: 552_000, key: "out:chk:Esimerkkikortti", payee: "Esimerkkikortti", paymentCents: 46_000, months: 7, firstDate: "2026-03-12", lastDate: "2026-09-12" };

  const saved = (id: string, name: string): Loan => ({
    id, name, lender: null, kind: "card", grantedCents: null, balanceCents: 120_000, balanceDate: "2026-10-01",
    rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: 300_000, seriesKey: null,
  });

  it("offers no such answer while no card loan is saved", () => {
    stubApi({});
    show({ ...card, savedCards: [] });
    expect(screen.queryByRole("button", { name: "Kortti on jo kirjattu" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Avaa kirjattu kortti" })).toBeNull();
  });

  it("links the one saved card to the series of its bills, writes no mark, and links to the saved card", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [saved("l1", "Esimerkkikortti")], fixings: {} }, "PUT /api/loans/l1": { loan: saved("l1", "Esimerkkikortti") } });
    let reloads = 0;
    show({ ...card, savedCards: [{ id: "l1", name: "Esimerkkikortti" }] }, () => void reloads++);
    expect(screen.getByRole("link", { name: "Avaa kirjattu kortti" }).getAttribute("href")).toContain("linkLoan=l1");
    fireEvent.click(screen.getByRole("button", { name: "Kortti on jo kirjattu" }));
    await waitFor(() => expect(reloads).toBe(1), T);
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /api/loans", "PUT /api/loans/l1"]);
    expect(seen[1]!.body).toMatchObject({ name: "Esimerkkikortti", kind: "card", balanceCents: 120_000, limitCents: 300_000, seriesKey: card.key });
    expect(seen.some((s) => s.path === "/api/marks")).toBe(false);
  });

  it("asks which saved card it is when there are several, and links the one picked", async () => {
    queryClient.clear();
    const loans = [saved("l1", "Esimerkkikortti"), saved("l2", "Toinen kortti")];
    const seen = stubApi({ "GET /api/loans": { loans, fixings: {} }, "PUT /api/loans/l2": { loan: loans[1] } });
    let reloads = 0;
    show({ ...card, savedCards: loans.map((l) => ({ id: l.id, name: l.name })) }, () => void reloads++);
    expect(screen.queryByRole("link", { name: "Avaa kirjattu kortti" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kortti on jo kirjattu" }));
    expect(seen).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Toinen kortti" }));
    await waitFor(() => expect(reloads).toBe(1), T);
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /api/loans", "PUT /api/loans/l2"]);
    expect(seen[1]!.body).toMatchObject({ name: "Toinen kortti", seriesKey: card.key });
  });
});

describe("the question of a loan's kind", () => {
  it("opens the form that asks the balance as soon as the kind is answered, and keeps the kind as the answer", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [] }, "PUT /api/marks": {} });
    let reloads = 0;
    show({ id: "loan:k", kind: "loan", cents: 300_000, key: "k", payee: "Esimerkkirahoitus", paymentCents: 25_000, months: 9, firstDate: "2026-01-05", lastDate: "2026-09-05", guess: "consumer", placed: false }, () => void reloads++);
    fireEvent.click(screen.getByRole("button", { name: /^Kulutusluotto/ }));
    await screen.findByLabelText(/Lainaa jäljellä/, {}, T);
    await waitFor(() => expect(seen.find((s) => s.method === "PUT")?.body).toEqual({ subject: "question:loan-kind:consumer:k", mark: "in_use" }), T);
    expect(reloads).toBe(0);
  });

  it("shows the error and opens no form when the kind cannot be saved", async () => {
    queryClient.clear();
    const seen = stubApi({ "PUT /api/marks": failing(400, { error: "Tallennus epäonnistui." }) });
    show({ id: "loan:k", kind: "loan", cents: 300_000, key: "k", payee: "Esimerkkirahoitus", paymentCents: 25_000, months: 9, firstDate: "2026-01-05", lastDate: "2026-09-05", guess: "consumer", placed: false });
    fireEvent.click(screen.getByRole("button", { name: /^Kulutusluotto/ }));
    await screen.findByText(/epäonnistui/, {}, T);
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["PUT /api/marks"]);
    expect(screen.queryByLabelText(/Lainaa jäljellä/)).toBeNull();
  });
});
