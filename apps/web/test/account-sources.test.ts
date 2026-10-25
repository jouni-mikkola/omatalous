import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSources, hasSources } from "../src/pages/settings/AccountSources.tsx";
import type { Account, Meta } from "../src/types.ts";

// the answer of the route stands in for the request
let answer: { months: unknown[] } | null = null;
vi.mock("../src/hooks.ts", () => ({ useApi: () => ({ data: answer, error: null, loading: false, reload: () => {} }) }));

type Col = { userId: string | null; paidInCents: number; costsCents: number; movedCents: number; takenCents: number; leftCents: number };
const col = (userId: string | null, over: Partial<Col> = {}): Col => ({ userId, paidInCents: 0, costsCents: 0, movedCents: 0, takenCents: 0, leftCents: 0, ...over });
const month = (month: string, columns: Col[]) => ({ month, columns });
const meta = {
  user: { id: "u-aino", displayName: "Aino" },
  members: [
    { id: "u-aino", displayName: "Aino" },
    { id: "u-ville", displayName: "Ville" },
    { id: "u-cecilia", displayName: "Cecilia" },
  ],
} as unknown as Meta;
const joint = { id: "pool-a", use: { users: [{ userId: "u-aino" }, { userId: "u-ville" }] } } as unknown as Account;

const html = () => renderToStaticMarkup(createElement("table", null, createElement("tbody", null, createElement(AccountSources, { account: joint, meta }))));
// the euro sign and the spaces of a figure come from Intl: compare the digits
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/[\s ]+/g, " ").trim();
// the digits of cells, with the minus sign (U+2212) a figure below zero is drawn with
const digits = (cells: string[]) => cells.map((c) => c.replace(/[^\d,–\u2212-]/g, ""));
const cellsOf = (markup: string, label: string) => {
  const row = [...markup.matchAll(/<tr[^>]*><th scope="row"[^>]*>([^<]*)<\/th>(.*?)<\/tr>/g)].find((m) => m[1] === label);
  return [...row![2]!.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => text(m[1]!));
};

beforeEach(() => {
  answer = null;
});

describe("AccountSources", () => {
  it("draws nothing while the months are on their way, for an account with no trace and for one with no month", () => {
    expect(html()).not.toContain("Maksut ja menot");
    answer = { months: [] };
    expect(html()).not.toContain("Maksut ja menot");
  });

  it("T11: a month is a column for each member and one for the rest, and the rows say who paid in, bore, moved, took and has left", () => {
    answer = {
      months: [
        month("2026-08", [
          col("u-aino", { paidInCents: 115000, costsCents: 110437, takenCents: 40000, leftCents: 4563 }),
          col("u-ville", { paidInCents: 40000, movedCents: 40000 }),
          col(null),
        ]),
      ],
    };
    const markup = html();
    expect(text(markup)).toContain("Tilille tullut ja lähtenyt raha kuukausittain Elokuu 2026");
    expect([...markup.matchAll(/<th scope="col"[^>]*>(?!<span class="sr-only">)(.*?)<\/th>/g)].map((m) => m[1])).toEqual(["Aino", "Ville", "Ei tiedossa"]);
    expect([...markup.matchAll(/<th scope="row"[^>]*>(.*?)<\/th>/g)].map((m) => m[1])).toEqual(["Maksettu tilille", "Menot", "Siirretty tililtä", "Omat tilisiirrot", "Saldo kuun lopussa"]);
    expect(digits(cellsOf(markup, "Maksettu tilille"))).toEqual(["1150,00", "400,00", "–"]);
    expect(digits(cellsOf(markup, "Menot"))).toEqual(["1104,37", "–", "–"]);
    expect(digits(cellsOf(markup, "Siirretty tililtä"))).toEqual(["–", "400,00", "–"]);
    expect(digits(cellsOf(markup, "Omat tilisiirrot"))).toEqual(["400,00", "–", "–"]);
    expect(digits(cellsOf(markup, "Saldo kuun lopussa"))).toEqual(["45,63", "–", "–"]);
  });

  it("is a dash for 0,00, and a dash is no link; a figure is a link", () => {
    answer = { months: [month("2026-08", [col("u-aino", { paidInCents: 5000 }), col("u-ville"), col(null)])] };
    const markup = html();
    expect(cellsOf(markup, "Menot")).toEqual(["–", "–", "–"]);
    expect(cellsOf(markup, "Saldo kuun lopussa")).toEqual(["–", "–", "–"]);
    expect(cellsOf(markup, "Maksettu tilille")[1]).toBe("–");
    expect([...markup.matchAll(/<a /g)]).toHaveLength(1);
  });

  it("links each figure but the balance to the account's rows of the month in Tapahtumat", () => {
    answer = { months: [month("2026-02", [col("u-aino", { paidInCents: 100, costsCents: 200, movedCents: 300, takenCents: 400, leftCents: 500 }), col("u-ville"), col(null)])] };
    const links = [...html().matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);
    expect(links).toEqual(Array(4).fill("#/transactions?accountId=pool-a&amp;from=2026-02-01&amp;to=2026-02-28"));
    // near miss: a leap year's February ends on the 29th, and a month of 31 days on the 31st
    answer = { months: [month("2028-02", [col("u-aino", { costsCents: 1 })])] };
    expect([...html().matchAll(/<a href="([^"]*)"/g)].map((m) => m[1])).toEqual(["#/transactions?accountId=pool-a&amp;from=2028-02-01&amp;to=2028-02-29"]);
    answer = { months: [month("2026-12", [col("u-aino", { costsCents: 1 })])] };
    expect([...html().matchAll(/<a href="([^"]*)"/g)].map((m) => m[1])).toEqual(["#/transactions?accountId=pool-a&amp;from=2026-12-01&amp;to=2026-12-31"]);
  });

  it("keeps the rest column for every account, and gives three members three columns and the rest", () => {
    answer = { months: [month("2026-08", [col("u-aino"), col("u-ville"), col("u-cecilia"), col(null)])] };
    const markup = html();
    expect([...markup.matchAll(/<th scope="col"[^>]*>(?!<span class="sr-only">)(.*?)<\/th>/g)].map((m) => m[1])).toEqual(["Aino", "Ville", "Cecilia", "Ei tiedossa"]);
    expect(cellsOf(markup, "Menot")).toHaveLength(4);
    expect(markup).toContain("--src-cols:4");
  });

  it("opens the newest month and shows the older ones as their name alone", () => {
    answer = { months: ["2026-08", "2026-07", "2026-06", "2026-05"].map((m) => month(m, [col("u-aino", { costsCents: 100 }), col("u-ville"), col(null)])) };
    const markup = html();
    expect([...markup.matchAll(/aria-expanded="(true|false)"/g)].map((m) => m[1])).toEqual(["true", "false", "false", "false"]);
    expect([...markup.matchAll(/<table class="[^"]*acc-src-table/g)]).toHaveLength(1);
    expect(text(markup)).toContain("Toukokuu 2026");
  });

  it("draws a figure below zero with its minus sign", () => {
    answer = { months: [month("2026-10", [col("u-aino", { costsCents: -8000, movedCents: -8000, leftCents: -4563 }), col("u-ville", { takenCents: -8000 }), col(null)])] };
    const markup = html();
    expect(digits(cellsOf(markup, "Menot"))).toEqual(["\u221280,00", "–", "–"]);
    expect(digits(cellsOf(markup, "Omat tilisiirrot"))).toEqual(["–", "\u221280,00", "–"]);
    expect(digits(cellsOf(markup, "Saldo kuun lopussa"))).toEqual(["\u221245,63", "–", "–"]);
    // near miss: a figure above zero has no sign
    answer = { months: [month("2026-10", [col("u-aino", { costsCents: 8000 }), col("u-ville"), col(null)])] };
    expect(digits(cellsOf(html(), "Menot"))[0]).toBe("80,00");
  });

  it("gives the holder who has no login a column named as the account's use names them, and no other column that name", () => {
    const named = { id: "pool-a", use: { users: [{ userId: "u-aino", label: "Aino" }, { userId: null, label: "Muu tilinomistaja" }] } } as unknown as Account;
    answer = { months: [month("2026-08", [col("u-aino", { paidInCents: 100000 }), { ...col(null, { paidInCents: 250000 }), holder: true } as Col, col(null)])] };
    const draw = (account: Account) => renderToStaticMarkup(createElement("table", null, createElement("tbody", null, createElement(AccountSources, { account, meta }))));
    const markup = draw(named);
    expect([...markup.matchAll(/<th scope="col"[^>]*>(?!<span class="sr-only">)(.*?)<\/th>/g)].map((m) => m[1])).toEqual(["Aino", "Muu tilinomistaja", "Ei tiedossa"]);
    expect(cellsOf(markup, "Maksettu tilille").map((c) => c.replace(/[^\d,–]/g, ""))).toEqual(["1000,00", "2500,00", "–"]);
    expect(markup).toContain("--src-cols:3");
    // the holder's name is the bank's own line, where the viewer may read it
    const bank = { id: "pool-a", use: { users: [{ userId: "u-aino", label: "Aino" }, { userId: null, label: "VIRTANEN MATTI" }] } } as unknown as Account;
    expect([...draw(bank).matchAll(/<th scope="col"[^>]*>(?!<span class="sr-only">)(.*?)<\/th>/g)].map((m) => m[1])).toEqual(["Aino", "VIRTANEN MATTI", "Ei tiedossa"]);
  });

  it("gives a joint account a place and another account none", () => {
    expect(hasSources(joint)).toBe(true);
    expect(hasSources({ id: "a", use: { users: [{ userId: "u-aino" }] } } as unknown as Account)).toBe(false);
    expect(hasSources({ id: "a" } as unknown as Account)).toBe(false);
  });

  it("holds no colour of its own and no sentence", () => {
    answer = { months: [month("2026-08", [col("u-aino", { costsCents: 100 }), col("u-ville"), col(null)])] };
    expect(html()).not.toMatch(/style="[^"]*#|rgb\(|<p[ >]/);
  });
});
