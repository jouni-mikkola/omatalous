/**
 * Huomioitavaa shows only what needs the household: a bill that did not come, a loan with nothing saved, a price that
 * rose. Rows of "Saapunut raha" with a person's name and a year's sum said nothing to act on and pushed those out.
 */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Notable } from "../src/components/home/Notable.tsx";
import { notableOf } from "../src/pages/Overview.tsx";
import { needsUser, type ReviewItem, withFirst } from "../src/pages/review-items.ts";

const payer = (id: string, merchant: string, cents: number): ReviewItem => ({ kind: "payer", id, key: id, cents, merchant, count: 12, lastDate: "2026-11-01", options: ["own_money", "pay"], proposal: null });
const payee = (id: string, merchant: string, cents: number): ReviewItem => ({ kind: "payee_in", id, cents, merchant, count: 4, lastDate: "2026-11-02", picks: [] });
const loan = (id: string, payee: string): ReviewItem => ({ kind: "loan", id, key: id, cents: 120_000, payee, paymentCents: 10_000, months: 12, firstDate: "2025-12-01", lastDate: "2026-11-01", guess: "consumer", placed: true });
const bill = (id: string, merchant: string): ReviewItem => ({ kind: "bill", id, cents: 6_000, merchant, seriesId: id, subject: `series:${id}`, comingSubject: `coming:${id}`, dueDate: "2026-11-05" });
const sub = (id: string, reason: "price" | "new" | "quiet"): ReviewItem => ({
  kind: "subscription",
  id,
  cents: 12_000,
  reason,
  ...(reason === "price" ? { price: { fromCents: 900, toCents: 1_000, date: "2026-10-01" } } : reason === "new" ? { since: "2026-10-01" } : {}),
  seriesId: id,
  subject: `series:${id}`,
  merchant: "Palvelu",
  monthlyCents: 1_000,
  lastDate: "2026-11-01",
});

const titles = (items: ReviewItem[]) => [...render(createElement(Notable, notableOf(items))).container.querySelectorAll(".home-note-title")].map((e) => e.textContent);

describe("Huomioitavaa", () => {
  afterEach(cleanup);

  it("leaves out who a payer is and what an income is, and shows the loan and the bill after them in the queue", () => {
    const items = [payer("p1", "Maija Meikäläinen", 974_700), payee("p2", "Esimerkkipankki", 540_542), loan("l1", "Rahoitus Oy"), payer("p3", "Matti", 100_000), bill("b1", "Sähkö Oy")];
    expect(titles(items)).toEqual(["Rahoitus Oy", "Sähkö Oy"]);
  });

  it("is not drawn when every open item only sorts money, however many there are", () => {
    const items = [payer("p1", "Maija Meikäläinen", 974_700), payee("p2", "Esimerkkipankki", 540_542), sub("s1", "quiet")];
    expect(render(createElement(Notable, notableOf(items))).container.innerHTML).toBe("");
  });

  it("shows at most three, and counts every open item in its link", () => {
    const items = [loan("l1", "A"), bill("b1", "B"), sub("s1", "price"), sub("s2", "new"), payer("p1", "C", 1)];
    const { container } = render(createElement(Notable, notableOf(items)));
    expect(container.querySelectorAll(".home-note")).toHaveLength(3);
    expect(container.querySelector(".home-more")?.textContent).toBe("Kaikki 5 tarkistettavaa");
  });

  it("asks of a subscription only when its price rose or it is new", () => {
    expect([sub("a", "price"), sub("b", "new"), sub("c", "quiet")].map(needsUser)).toEqual([true, true, false]);
  });

  it("a row opens Tarkistettavat at its own item", () => {
    const items = [payer("p1", "Maija", 974_700), loan("l1", "Rahoitus Oy")];
    const href = render(createElement(Notable, notableOf(items))).container.querySelector(".home-note")?.getAttribute("href");
    expect(href).toBe("#/review?item=l1");
    expect(withFirst(items, "l1").map((i) => i.id)).toEqual(["l1", "p1"]);
    expect(withFirst(items, "gone").map((i) => i.id)).toEqual(["p1", "l1"]);
    expect(withFirst(items, null).map((i) => i.id)).toEqual(["p1", "l1"]);
  });
});
