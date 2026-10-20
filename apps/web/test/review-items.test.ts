/** Tarkistettavat's sitting and words: at most 25 items, the guess first, a split asked with no guess (owner rule L5). */
import { describe, expect, it } from "vitest";
import { eyebrow, figureOf, groupCategories, offeredCategories, loanKindChoices, nameOf, NEW_SITTING, payerChoices, planEnd, questionOf, type ReviewItem, SITTING, sittingView } from "../src/pages/review-items.ts";

const payee = (n: number): ReviewItem => ({ kind: "payee_out", id: `payee_out:Kauppa ${n}`, cents: 100_000 - n, merchant: `Kauppa ${n}`, count: 3, lastDate: "2026-09-20", picks: [] });
const queue = (n: number) => Array.from({ length: n }, (_, i) => payee(i));

describe("a sitting", () => {
  it("shows the first open item and counts the items it will show", () => {
    const view = sittingView(queue(3), NEW_SITTING);
    expect(view).toMatchObject({ state: "item", position: 1, of: 3, open: 3 });
    expect(view.state === "item" && view.item.id).toBe("payee_out:Kauppa 0");
  });

  it("takes an answered item away at once and moves past a skipped one", () => {
    const view = sittingView(queue(3), { answered: ["payee_out:Kauppa 0"], skipped: ["payee_out:Kauppa 1"] });
    // the answered one is no longer open; the skipped one still is
    expect(view).toMatchObject({ state: "item", position: 3, of: 3, open: 2 });
    expect(view.state === "item" && view.item.id).toBe("payee_out:Kauppa 2");
  });

  it("ends after 25 items, answered or skipped, with the count left", () => {
    const items = queue(40);
    const answered = items.slice(0, 20).map((i) => i.id);
    const skipped = items.slice(20, 25).map((i) => i.id);
    expect(SITTING).toBe(25);
    expect(sittingView(items, { answered, skipped })).toEqual({ state: "enough", left: 20 });
    expect(sittingView(items, { answered: answered.slice(1), skipped })).toMatchObject({ state: "item", position: 25, of: 25 });
  });

  it("says when only skipped items are left, and when nothing is", () => {
    const items = queue(2);
    expect(sittingView(items, { answered: [items[0]!.id], skipped: [items[1]!.id] })).toEqual({ state: "skipped", left: 1 });
    expect(sittingView([], NEW_SITTING)).toEqual({ state: "empty" });
    // the queue read again holds no answered item: the sitting's list of them changes nothing
    expect(sittingView(items.slice(1), { answered: [items[0]!.id], skipped: [] })).toMatchObject({ state: "item", position: 2, of: 2 });
  });
});

describe("the choices", () => {
  it("put the app's guess first", () => {
    const payer: ReviewItem = { kind: "payer", id: "payer:k", cents: 90_000, key: "name:X", merchant: "Esimerkki Ville", count: 3, lastDate: "2026-09-03", options: ["cost_share", "sales", "own_money", "gift", "pay"], proposal: "pay" };
    expect(payerChoices(payer).map((c) => [c.value, c.guess])).toEqual([["pay", true], ["cost_share", false], ["sales", false], ["own_money", false], ["gift", false]]);
    const loan: ReviewItem = { kind: "loan", id: "loan:k", cents: 300_000, key: "k", payee: "Esimerkkirahoitus", paymentCents: 25_000, months: 9, firstDate: "2026-01-05", lastDate: "2026-09-05", guess: "car", placed: false };
    expect(loanKindChoices(loan)[0]).toMatchObject({ value: "car", guess: true });
    // "Muu laina" is no guess worth marking
    expect(loanKindChoices({ ...loan, guess: "other" }).some((c) => c.guess)).toBe(false);
  });

  it("ask a split with no guess", () => {
    const split: ReviewItem = { kind: "split", id: "split:a:opening:o", cents: 312_045, accountId: "a", accountName: "Yhteistili", question: "opening", key: "o", label: "2026-07-01" };
    expect(split).not.toHaveProperty("guess");
    expect([eyebrow(split), nameOf(split), questionOf(split)]).toEqual(["Yhteinen tili: Yhteistili", "Saldo ennen 1.7.2026", "Kenen rahaa tämä oli?"]);
  });

  it("say a subscription's month and year", () => {
    const sub: ReviewItem = { kind: "subscription", id: "s", cents: 15_588, seriesId: "out:chk:Max", subject: "series:out:chk:Max#1299", merchant: "Max", monthlyCents: 1299, lastDate: "2026-10-08" };
    const f = figureOf(sub);
    expect([f.text.replace(/\s/g, " "), f.unit]).toEqual(["12,99 €", "kuussa"]);
    expect(f.line.replace(/\s/g, " ")).toBe("155,88 € vuodessa, viimeksi 8.10.2026");
  });

  it("count a plan's payments left from its latest payment, and take only a whole number from 1 to 120", () => {
    const plan: ReviewItem = { kind: "plan", id: "plan:k", cents: 59_880, key: "k", payee: "Klarna", paymentCents: 4990, lastDate: "2026-09-12" };
    expect([eyebrow(plan), questionOf(plan)]).toEqual(["Osamaksu", "Montako maksua on vielä jäljellä?"]);
    expect(planEnd(plan, "1")).toBe("2026-10");
    expect(planEnd(plan, " 6 ")).toBe("2027-03");
    expect(planEnd(plan, "120")).toBe("2036-09");
    for (const bad of ["", "0", "121", "2,5", "-1", "kaksi"]) expect(planEnd(plan, bad), bad).toBeNull();
  });

  it("offer a payee the categories the old picker offered, grouped, and find them by a part of the name", () => {
    const cats = [
      { id: "groceries", label: "Ruokakauppa", kind: "expense", group: "Ruoka" },
      { id: "restaurants", label: "Ravintolat", kind: "expense", group: "Ruoka" },
      { id: "other", label: "Muut menot", kind: "expense", group: "Muut" },
      { id: "salary", label: "Palkka", kind: "income", group: "Tulot" },
    ];
    expect(offeredCategories(cats, false).map((c) => c.id)).toEqual(["groceries", "restaurants", "salary"]);
    expect(offeredCategories(cats, true).map((c) => c.id)).toEqual(["salary"]);
    expect(groupCategories(offeredCategories(cats, false), "").map(([g, l]) => [g, l.length])).toEqual([["Ruoka", 2], ["Tulot", 1]]);
    expect(groupCategories(cats, "ravin").map(([, l]) => l.map((c) => c.id))).toEqual([["restaurants"]]);
    // a search for a group's name finds its categories; accents and case do not matter
    expect(groupCategories(cats, "RUOKA").flatMap(([, l]) => l.map((c) => c.id))).toEqual(["groceries", "restaurants"]);
    expect(groupCategories(cats, "xyz")).toEqual([]);
  });

  it("ask every loan its kind, the kind the rows suggest first, and a placed loan may be the kind the plain answers lack", () => {
    const loan = { kind: "loan", id: "loan:k", cents: 346_800, key: "k", payee: "Esimerkkirahoitus", paymentCents: 28_900, months: 14, firstDate: "2025-09-05", lastDate: "2026-10-05", guess: "instalment", placed: true } as const;
    expect(questionOf(loan)).toBe(questionOf({ ...loan, placed: false }));
    expect(loanKindChoices(loan).map((c) => [c.value, c.guess])[0]).toEqual(["instalment", true]);
    // an answer stored as a mark has only the plain kinds
    expect(loanKindChoices({ ...loan, placed: false }).map((c) => c.value)).not.toContain("instalment");
  });

  it("name the period of every figure", () => {
    const payee: ReviewItem = { kind: "payee_out", id: "p", cents: 23_880, merchant: "Kauppa", count: 3, lastDate: "2026-09-20", picks: [] };
    const loan: ReviewItem = { kind: "loan", id: "l", cents: 300_000, key: "k", payee: "Pankki", paymentCents: 25_000, months: 14, firstDate: "2026-01-05", lastDate: "2026-10-05", guess: "car", placed: true, rowCount: 10 };
    expect(figureOf(payee).unit).toBe("vuodessa");
    expect(figureOf(loan).unit).toBe("kuussa");
    // the line counts the rows the card shows, not the calendar months the series spans
    expect(figureOf(loan).line).toBe("10 maksua 5.1.2026 alkaen, viimeksi 5.10.2026");
  });
});

describe("a number Säästövinkit waits for", () => {
  const input = (more: Partial<Extract<ReviewItem, { kind: "input" }>> = {}): ReviewItem => ({ kind: "input", id: "input:car_km", cents: 0, key: "car_km", def: "car_km", subject: null, old: null, ...more });

  it("is asked as a question under Säästövinkit, by the field's own name", () => {
    expect(eyebrow(input())).toBe("Säästövinkit");
    expect(nameOf(input())).toBe("Ajomäärä");
    expect(questionOf(input())).toBe("Paljonko ajat vuodessa?");
    // a number has no rows behind it: the server sends none
    expect(input().rows).toBeUndefined();
  });

  it("shows the estimate it makes exact, and no figure when only a check waits for it", () => {
    expect(figureOf(input({ cents: 52000 }))).toMatchObject({ text: expect.stringMatching(/^≈ 520\s€$/), unit: "vuodessa" });
    expect(figureOf(input()).text).toBe("");
    expect(figureOf(input({ old: { value: 12000, asOf: "2025-01-02" } })).line).toMatch(/^Edellinen tieto 12\s000 km vuodessa, annettu 2\.1\.2025, on liian vanha\./);
  });
});
