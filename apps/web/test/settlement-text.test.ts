import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { section } from "../src/pages/reports/sections/Balances.tsx";
import { hasNothing, holderNameOf } from "../src/pages/reports/sections/settlement-text.ts";
import type { ReportContext } from "../src/pages/reports/types.ts";
import { t } from "../src/text.ts";

const quiet = { members: [{ paid: 0, owed: 0 }, { paid: 0, owed: 0 }], unknownPaidBy: [], unknownOwedBy: [], unknownHolder: [], lines: [] };

describe("the pools of a month in Yhteiset menot", () => {
  it("a pool with nothing paid and no part for anyone has no row to list", () => {
    expect(hasNothing(quiet)).toBe(true);
    expect(hasNothing({ ...quiet, unknownPaidBy: [{ cents: 0 }] })).toBe(true);
  });
  it("a pool where anyone paid, owes a part, or has an unknown figure or a late correction is listed", () => {
    expect(hasNothing({ ...quiet, members: [{ paid: 1250, owed: 0 }, { paid: 0, owed: 0 }] })).toBe(false);
    expect(hasNothing({ ...quiet, members: [{ paid: 0, owed: 0 }, { paid: 0, owed: 600 }] })).toBe(false);
    expect(hasNothing({ ...quiet, unknownOwedBy: [{ cents: 300 }] })).toBe(false);
    expect(hasNothing({ ...quiet, unknownHolder: [{ cents: 300 }] })).toBe(false);
    expect(hasNothing({ ...quiet, lines: [{ kind: "late_change", cents: 700 }] })).toBe(false);
    expect(hasNothing({ ...quiet, lines: [{ kind: "late_change", cents: -700 }] })).toBe(false);
  });
  it("a late correction of 0,00 shows no row, so it does not keep the pool listed", () => {
    expect(hasNothing({ ...quiet, lines: [{ kind: "late_change", cents: 0 }] })).toBe(true);
  });
});

describe("a pool whose split nobody has told", () => {
  it("is listed for its costs", () => {
    const untold = [{ cents: 4000 }, { cents: 1250 }];
    expect(hasNothing({ ...quiet, untold })).toBe(false);
    expect(hasNothing({ ...quiet, untold: [] })).toBe(true);
  });
});

describe("the wording of the settlement answer", () => {
  it("names the member who paid above the share without the passive form", () => {
    expect(t("rpt.se_over_more")).toBe("Maksoi yli osuutensa");
    expect(t("rpt.se_over_less")).toBe("Maksoi osuuttaan vähemmän");
  });
});

describe("the answer under the balance chart", () => {
  const answerOf = (balances: object) => {
    const ctx = { data: { loans: { maybeTwice: [], overdraftTwice: [], loans: [], saved: 0, unsaved: [] }, balances }, meta: { today: "2026-10-11", accounts: [] }, running: "2026-10", scope: "own", exportHref: () => "" } as unknown as ReportContext;
    const html = renderToStaticMarkup(createElement(section.Component, { ctx })).replace(/[\s  ]+/g, " ");
    return /<p class="qc-a">(.*?)<\/p>/.exec(html)?.[1] ?? null;
  };
  const data = {
    months: ["2026-09", "2026-10"], total: [100_000, 120_000], monthChange: [null, 20_000], missing: [], accountsLessDebt: [null, null],
    daily: { from: "2026-09-30", cents: [100_000, 120_000] }, change: null, holdings: { accounts: [], cards: [], loans: [], debtCents: 0, unsavedLoans: null, netCents: null },
    accounts: [{ accountId: "a", name: "Käyttötili", asOf: "2026-10-11", values: [100_000, 120_000], changeCents: 20_000 }], debt: { day: "2026-10-11", cents: 0, savedCents: 0 },
  };
  it("names the lowest balance", () => {
    expect(answerOf({ ...data, lowest: { day: "2026-10-02", cents: 5000 } })).toContain("Alin saldo");
  });

  it("has no answer line when there is no lowest balance", () => {
    expect(answerOf({ ...data, lowest: null })).toBe("");
  });
});

describe("the co-holder with no login", () => {
  const use = (label: string) => ({ users: [{ userId: "a", label: "Matti Meikalainen", weight: 1 }, { userId: null, label, weight: 1 }] });
  it("is named as the account's use names them", () => {
    expect(holderNameOf(use("Maija Meikalainen"))).toBe("Maija Meikalainen");
  });
  it("has no name where the use says only that there is another holder, or has no such user", () => {
    expect(holderNameOf(use("Muu tilinomistaja"))).toBeNull();
    expect(holderNameOf({ users: [{ userId: "a", label: "Matti Meikalainen", weight: 1 }] })).toBeNull();
    expect(holderNameOf(undefined)).toBeNull();
  });
});
