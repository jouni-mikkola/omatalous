/**
 * Tarkistettavat on the real server: one question at a time, an answer goes to the route of its source and the next
 * question comes, a skipped one waits.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { queryClient } from "../src/query-client.ts";
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
    // the progress line shows the same place
    const line = document.querySelector<HTMLProgressElement>(".review-progress")!;
    expect([line.value, line.max]).toEqual([2, 3]);
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

  it("opens the loan's form with the payment the bank took and the day it moved on, asks that alone, and has no dismissal", async () => {
    queryClient.clear();
    const loan = { id: "loan-7", name: "Asuntolaina", lender: null, kind: "mortgage", grantedCents: null, balanceCents: 15_000_000, balanceDate: "2026-10-01", rateBp: 350, reference: "euribor_12", marginBp: 80, rateReviewDate: "2027-01-05", repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, endDate: "2046-01-05", limitCents: null, seriesKey: null };
    const seen = stubApi({ "GET /api/loans": { loans: [loan] }, "PUT /api/loans/loan-7": { loan } });
    const item = { id: "loan_drift:loan-7", kind: "loan_drift", cents: 0, loanId: "loan-7", name: "Asuntolaina", date: "2026-11-05", paidCents: 95_000, expectedCents: 90_000, newPaymentCents: 95_000, reviewDate: "2026-11-05" } as unknown as ReviewItem;
    const meta = { accounts: [], sharedAccounts: [], bank: { banks: [] }, today: "2026-11-18" } as unknown as Meta;
    render(createElement(Review, { meta, queue: { data: { items: [item] }, error: null, reload: () => {} } }));
    expect(document.querySelector(".review-item")!.textContent).toContain("Onko lainan kuukausierä muuttunut?");
    expect(choices().map((b) => b.textContent?.trim())).toEqual(["Päivitä lainan kuukausierä"]);
    fireEvent.click(screen.getByRole("button", { name: "Päivitä lainan kuukausierä" }));
    expect(((await screen.findByLabelText(/^Kuukausierä/, {}, T)) as HTMLInputElement).value).toMatch(/^950/);
    expect((screen.getByLabelText(/^Koron tarkistuspäivä/) as HTMLInputElement).value).toBe("2026-11-05");
    expect(screen.queryByLabelText(/^Lainaa jäljellä/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.some((s) => s.method === "PUT" && s.path === "/api/loans/loan-7")).toBe(true), T);
    expect(seen.find((s) => s.method === "PUT")!.body).toMatchObject({ paymentCents: 95_000, rateReviewDate: "2026-11-05" });
  });

  it("answers money a merchant may owe back with the mark of its alert: asked, right, and asked again once the wait is over", async () => {
    const seen = stubApi({ "PUT /api/marks": {} });
    const item = { id: "money_back:double:r2", kind: "money_back", cents: 16_743, merchant: "Verkkokauppa", reason: "double", count: 2, lastDate: "2026-09-20", askedOn: null, subject: "alert:double:r2" } as unknown as ReviewItem;
    const meta = { accounts: [], sharedAccounts: [], bank: { banks: [] }, today: "2026-10-09" } as unknown as Meta;
    const view = render(createElement(Review, { meta, queue: { data: { items: [item] }, error: null, reload: () => {} } }));
    expect(choices().map((b) => b.textContent?.trim())).toEqual(["Pyydän hyvityksen", "Veloitus on oikein"]);
    fireEvent.click(screen.getByRole("button", { name: "Pyydän hyvityksen" }));
    await waitFor(() => expect(seen).toHaveLength(1), T);
    expect(seen[0]!.body).toEqual({ subject: "alert:double:r2", mark: "in_use" });
    view.unmount();
    const again = { ...item, id: "money_back:double:r3", askedOn: "2026-09-01", subject: "alert:double:r3" } as unknown as ReviewItem;
    render(createElement(Review, { meta, queue: { data: { items: [again] }, error: null, reload: () => {} } }));
    expect(document.querySelector(".review-item")!.textContent).toContain("Pyysit hyvitystä 1.9.");
    fireEvent.click(screen.getByRole("button", { name: "Pyydän hyvityksen" }));
    await waitFor(() => expect(seen).toHaveLength(2), T);
    expect(seen[1]!.body).toEqual({ subject: "alert:double:r3", mark: "cancelled" });
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

  it("asks an add-on module's question: an answer goes to the route the choice names and a link opens a page of the app", async () => {
    const seen = stubApi({ "PUT /api/example/renew": { ok: true } });
    const asked = {
      kind: "extension", id: "example:renew", cents: 0, type: "example_renew", title: "Esimerkkikauppa", question: "Kirjaudutaanko kauppaan uudelleen?", detail: "Kirjautuminen vanhentui", guess: "go",
      choices: [{ id: "go", label: "Kyllä", answer: { method: "PUT", path: "/api/example/renew", body: { again: true } } }, { id: "open", label: "Avaa kauppa", href: "#/example" }],
    };
    const meta = { accounts: [{}], sharedAccounts: [], bank: { banks: [] } } as unknown as Meta;
    render(createElement(Review, { meta, queue: { data: { items: [asked, { id: "m", kind: "mortgage", cents: 0 }] as unknown as ReviewItem[] }, error: null, reload: () => {} } }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Kirjaudutaanko kauppaan uudelleen?");
    expect(document.querySelector(".review-item")!.textContent).toContain("Esimerkkikauppa");
    expect(document.querySelector(".review-item")!.textContent).toContain("Kirjautuminen vanhentui");
    expect(screen.getByRole("link", { name: "Avaa kauppa" }).getAttribute("href")).toBe("#/example");
    fireEvent.click(screen.getByRole("button", { name: "Kyllä" }));
    await waitFor(() => expect(seen).toHaveLength(1), T);
    expect(seen[0]).toMatchObject({ method: "PUT", path: "/api/example/renew", body: { again: true } });
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Kysymys 2 / 2"), T);
  });

  it("links a temporary password that has waited over a week to the members, where it is changed or removed", () => {
    const seen = stubApi({});
    const items = [{ kind: "temporary_password", id: "temporary_password:u1", cents: 0, userId: "u1", name: "Eero" }] as unknown as ReviewItem[];
    const meta = { accounts: [{}], sharedAccounts: [], bank: { banks: [] } } as unknown as Meta;
    render(createElement(Review, { meta, queue: { data: { items }, error: null, reload: () => {} } }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Väliaikainen salasana on odottanut yli viikon");
    expect(document.querySelector(".review-item")!.textContent).toContain("Eero");
    expect(screen.getByRole("link", { name: "Avaa Jäsenet" }).getAttribute("href")).toBe("#/settings/members");
    expect(seen).toEqual([]);
  });

  it("saves a mortgage from Lisää asuntolaina in place and moves on to the next question", async () => {
    queryClient.clear();
    const seen = stubApi({ "GET /api/loans": { loans: [] }, "POST /api/loans": (s: { body: unknown }) => ({ loan: { id: "loan-1", ...(s.body as object) } }) });
    const items: ReviewItem[] = ["a", "b"].map((id) => ({ id, kind: "mortgage", cents: 0 }));
    const meta = { accounts: [], sharedAccounts: [], bank: { banks: [] }, today: "2026-11-18" } as unknown as Meta;
    render(createElement(Review, { meta, queue: { data: { items }, error: null, reload: () => {} } }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Kysymys 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: "Lisää asuntolaina" }));
    const form = await screen.findByRole("region", { name: "Uusi laina" }, T);
    expect((within(form).getByLabelText("Laji") as HTMLSelectElement).value).toBe("mortgage");
    fireEvent.change(within(form).getByLabelText("Nimi"), { target: { value: "Asuntolaina" } });
    fireEvent.change(within(form).getByLabelText("Lainaa jäljellä (€)"), { target: { value: "120 000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Kysymys 2 / 2"), T);
    const post = seen.filter((s) => s.method === "POST" && s.path === "/api/loans");
    expect(post).toHaveLength(1);
    expect(post[0]!.body).toMatchObject({ name: "Asuntolaina", kind: "mortgage", balanceCents: 12_000_000 });
    expect(screen.queryByRole("region", { name: "Uusi laina" })).toBeNull();
  });
});
