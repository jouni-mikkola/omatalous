/**
 * The figures the pages show under a name: what the name means, which function computes it and where it is read. One
 * name means one figure on every page (ADR 0020). Two things that differ in what they count get two names here, even
 * when the code gave them one field name: `dueCents` of the front page (the window to the payday) and of Laskut (a
 * calendar month) is the case. `source.file` is
 * under `packages/core/src` and `source.fn` and `source.field` are found in it (repo rule 37), so a figure moved or
 * renamed in code fails until this list follows. `packages/core/test/figures.test.ts` reads every figure in each answer
 * that carries it and holds them equal. The limits the figures use are in `thresholds.ts`.
 */

type FigureUnit = "cents" | "share" | "months";

interface Figure {
  /** The name the pages show, as the glossary of docs/UI_STYLE.md spells it. */
  name: string;
  definition: string;
  source: {
    /** Relative to packages/core/src. */
    file: string;
    /** The function that computes the figure. */
    fn: string;
    /** The field of its answer that holds the figure. */
    field: string;
  };
  unit: FigureUnit;
  /** The pages that show it, by their names in the navigation. */
  pages: readonly string[];
}

export const FIGURES = {
  spending: {
    name: "Menot",
    definition: "Consumption and debt service of the period, net of refunds: everything that left for good. Saving and own transfers are not in it.",
    source: { file: "analysis/flows.ts", fn: "totalsOf", field: "expenseCents" },
    unit: "cents",
    pages: ["Yhteenveto", "Raportit"],
  },
  consumption: {
    name: "Kulutus",
    definition: "Goods and services of the period, net of refunds. Menot less the debt service.",
    source: { file: "analysis/flows.ts", fn: "totalsOf", field: "consumptionCents" },
    unit: "cents",
    pages: ["Yhteenveto", "Raportit"],
  },
  left: {
    name: "Tulos",
    definition: "Income plus credit drawn less spending and less what went to savings: what stayed on the accounts. Negative when the accounts were drawn on.",
    source: { file: "analysis/flows.ts", fn: "totalsOf", field: "leftCents" },
    unit: "cents",
    pages: ["Yhteenveto", "Raportit"],
  },
  saved: {
    name: "Säästöön siirretty",
    definition: "The savings categories and the transfers into the household's own savings accounts, less what was taken out of them.",
    source: { file: "analysis/flows.ts", fn: "totalsOf", field: "savedCents" },
    unit: "cents",
    pages: ["Yhteenveto", "Raportit"],
  },
  savingsRate: {
    name: "Säästöaste",
    definition: "Saved over income, pooled over the complete months of the window, which the label names. A running or partly covered month is not part of it.",
    source: { file: "analysis/bridge.ts", fn: "savingsRateOf", field: "rate" },
    unit: "share",
    pages: ["Yhteenveto", "Raportit"],
  },
  due: {
    name: "Erääntyvät maksut",
    definition: "What the counted accounts pay before the next payday or in 30 days. It holds recurring bills, bills typed in and connected cards' bills. An own transfer is no payment, so it is not in it.",
    source: { file: "analysis/ahead.ts", fn: "aheadBasis", field: "dueCents" },
    unit: "cents",
    pages: ["Yhteenveto", "Laskut"],
  },
  ownTransfers: {
    name: "Siirrot omille tileille",
    definition: "Regular transfers from the counted accounts to accounts the balance does not count, in the same window as Erääntyvät maksut. They leave the balance and are no payments.",
    source: { file: "analysis/ahead.ts", fn: "aheadBasis", field: "transferCents" },
    unit: "cents",
    pages: ["Yhteenveto"],
  },
  free: {
    name: "Käytettävissä",
    definition: "The balance of the counted accounts today less Erääntyvät maksut and Siirrot omille tileille.",
    source: { file: "analysis/ahead.ts", fn: "aheadBasis", field: "freeCents" },
    unit: "cents",
    pages: ["Yhteenveto"],
  },
  runway: {
    name: "Jää palkkapäivänä",
    definition: "What the counted accounts hold on the day before the next payday: today's balance less Käytettävissä's payments and own transfers and less the everyday spending expected on the days to the payday that the accounts pay themselves, with a range from the lower to the upper quartile of the base months. A card's purchases are taken off once, with the bill that pays them. A bill in the window holds the purchases made, and for a card paid in full also those expected up to its day. Later purchases wait for a bill after the payday. Without a known payday, a balance or three complete months the answer says why and gives no figure.",
    source: { file: "analysis/runway.ts", fn: "runwayOf", field: "leftCents" },
    unit: "cents",
    pages: ["Yhteenveto"],
  },
  everyday: {
    name: "Arkimenot päivässä",
    definition: "The expected everyday spending of a day over every account in view. A card's purchases are in it. It is the mean of the complete months before the month: six at most, three at least. Subscriptions, bills, card bills and one-off purchases are left out (ADR 0021).",
    source: { file: "analysis/expected.ts", fn: "expectedEverydayPerDay", field: "cents" },
    unit: "cents",
    pages: ["Yhteenveto"],
  },
  allowance: {
    name: "Käytettävissä päivässä",
    definition: "Käytettävissä spread over the days from today to the day before the next payday, today included: what each of those days may cost for the payments to stay covered. Nothing without a payday to count to or with nothing free. Arkimenot päivässä is what the days are expected to cost, this is what they may.",
    source: { file: "home.ts", fn: "homeRunway", field: "allowancePerDayCents" },
    unit: "cents",
    pages: ["Yhteenveto"],
  },
  paceGap: {
    name: "Ero odotettuun",
    definition: "What the month has cost so far less what it is expected to have cost on the same day (Odotettu). Above zero the month is dearer. Its three largest categories and the rest add up to it to the cent.",
    source: { file: "home.ts", fn: "homePace", field: "diffCents" },
    unit: "cents",
    pages: ["Yhteenveto"],
  },
  usualSpend: {
    name: "Tavalliset menot",
    definition: "The row of Varat ja velat: the expected spending (Odotettu) of the running month, all its days, so Kuukausi, the buffer and the row read one figure. One-offs are left out. The direction word compares the last three complete months with the mean of up to twelve, which is shown nowhere.",
    source: { file: "home.ts", fn: "homeDirection", field: "usualCents" },
    unit: "cents",
    pages: ["Yhteenveto"],
  },
  fixed: {
    name: "Kiinteät menot",
    definition: "The active subscriptions and bills a month: their spending and debt service. The card bill and a monthly saving are not in it.",
    source: { file: "commitments.ts", fn: "fixedMonthlyCents", field: "fixedMonthlyCents" },
    unit: "cents",
    pages: ["Yhteenveto", "Laskut", "Raportit"],
  },
  expected: {
    name: "Odotettu",
    definition: "What the month is expected to cost, to the same day of the month: the sum of the categories' expected figures, so every page that shows the month, a category or a bar adds up to it (ADR 0021). A category is the mean of the complete months before the month (up to six, at least three), a bill that comes every three months or less often is expected in its own month and a one-off purchase over 150 euros in a category that is rare is left out. Tavallisesti is gone from the pages.",
    source: { file: "analysis/expected.ts", fn: "expectedSpending", field: "expectedSpending" },
    unit: "cents",
    pages: ["Yhteenveto", "Raportit"],
  },
  expectedIncome: {
    name: "Odotetut tulot",
    definition: "The mean earned income of the six complete months before the month, at least three. Money from people and refunds are left out. The yardstick of the income shares of the findings.",
    source: { file: "analysis/expected.ts", fn: "expectedIncome", field: "expectedIncome" },
    unit: "cents",
    pages: ["Yhteenveto"],
  },
  regularIncome: {
    name: "Säännölliset tulot",
    definition: "The median regular income of the six complete months before the month, as many as three. The same months as Odotetut tulot, so the period is one. It counts regular series only, so the two differ and keep two names.",
    source: { file: "reports/income.ts", fn: "incomeReport", field: "medianCents" },
    unit: "cents",
    pages: ["Raportit"],
  },
  buffer: {
    name: "Puskuri",
    definition: "The balance of the savings and checking accounts, less the debt on credit cards and the bills due before the next payday, in months of usual spending.",
    source: { file: "reports/buffer.ts", fn: "bufferReport", field: "bufferMonths" },
    unit: "months",
    pages: ["Raportit"],
  },
  balanceChange: {
    name: "Saldomuutos",
    definition: "How far the total of the account balances moved from the close of the day before the range starts to the close of its last known day, so the rows of the first day are in it. Without a known balance the day before, it starts from the first day the balances are known on, and the answer names that day.",
    source: { file: "reports/balances.ts", fn: "balanceReport", field: "change" },
    unit: "cents",
    pages: ["Raportit"],
  },
  netWorth: {
    name: "Varat velkojen jälkeen",
    definition: "The account balances less the debts of the household: the cards used and the loans left.",
    source: { file: "holdings.ts", fn: "buildHoldings", field: "netCents" },
    unit: "cents",
    pages: ["Yhteenveto", "Raportit"],
  },
  cash: {
    name: "Säästö- ja käyttötilien saldo",
    definition: "The balance of the savings and checking accounts today. Cards and loans are not in it; Varat velkojen jälkeen takes the card debt and the loans off it.",
    source: { file: "holdings.ts", fn: "buildHoldings", field: "accountsCents" },
    unit: "cents",
    pages: ["Yhteenveto", "Raportit"],
  },
  periodLeft: {
    name: "Käteen jäi",
    definition: "Tulos of the range, the running month in it. The month rows of Tulot ja menot add up to it, and so does the headline of Tulot.",
    source: { file: "reports/cashflow.ts", fn: "cashflowReport", field: "whole" },
    unit: "cents",
    pages: ["Raportit"],
  },
} as const satisfies Record<string, Figure>;

