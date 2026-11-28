/**
 * The figures the pages show under a name: what the name means, which function computes it and where it is read. One
 * name means one figure on every page (ADR 0020). Two things that differ in what they count get two names here, even
 * when the code gave them one field name: `dueCents` of the front page (the window to the payday) and of Laskut (a
 * calendar month) is the case. `source.file` is
 * under `packages/core/src` and `source.fn` and `source.field` are found in it (repo rule 37), so a figure moved or
 * renamed in code fails until this list follows. `packages/core/test/figures.test.ts` reads every figure in each answer
 * that carries it and holds them equal. The limits the figures use are in `thresholds.ts`.
 *
 * Each figure says which view it is told for (`scope`) and whether the members' own views add up to the household's
 * (`additive`). Rule 52 holds the shape of an entry to this list, and the names of docs/MONEY_FLOWS.md and the entries here to each other.
 */

type FigureUnit = "cents" | "share" | "months";

/**
 * "own": the figure is read from the accounts of a view, each at the viewer's part (ADR 0016), and is told for a member's
 * own view as well as for the household's. "household": it has a meaning only for the household as a whole.
 */
type FigureScope = "own" | "household";

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
  scope: FigureScope;
  /**
   * Whether the figures of the members' own views add up to the household's, to the cent, for members who see the same
   * accounts. A share, a window to a payday, a usual level and a count of months do not.
   */
  additive: boolean;
  /** The pages that show it, by their names in the navigation. */
  pages: readonly string[];
}

export const FIGURES = {
  spending: {
    name: "Menot",
    definition: "Consumption and debt service of the period, net of refunds: everything that left for good. Saving and own transfers are not in it.",
    source: { file: "analysis/flows.ts", fn: "totalsOf", field: "expenseCents" },
    unit: "cents",
    scope: "own",
    additive: true,
    pages: ["Raportit"],
  },
  consumption: {
    name: "Kulutus",
    definition: "Goods and services of the period, net of refunds. Menot less the debt service.",
    source: { file: "analysis/flows.ts", fn: "totalsOf", field: "consumptionCents" },
    unit: "cents",
    scope: "own",
    additive: true,
    pages: ["Yhteenveto", "Raportit"],
  },
  left: {
    name: "Tulos",
    definition: "Income plus credit drawn less spending and less what went to savings: what stayed on the accounts. Negative when the accounts were drawn on.",
    source: { file: "analysis/flows.ts", fn: "totalsOf", field: "leftCents" },
    unit: "cents",
    scope: "own",
    additive: true,
    pages: ["Yhteenveto", "Tapahtumat", "Raportit"],
  },
  saved: {
    name: "Säästöön siirretty",
    definition: "The savings categories and the transfers into the household's own savings accounts, less what was taken out of them.",
    source: { file: "analysis/flows.ts", fn: "totalsOf", field: "savedCents" },
    unit: "cents",
    scope: "own",
    additive: true,
    pages: ["Yhteenveto", "Raportit"],
  },
  savingsRate: {
    name: "Säästöaste",
    definition: "Saved over income, pooled over the complete months of the window, which the label names. A running or partly covered month is not part of it.",
    source: { file: "analysis/bridge.ts", fn: "savingsRateOf", field: "rate" },
    unit: "share",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto", "Raportit"],
  },
  due: {
    name: "Erääntyvät maksut",
    definition: "What the counted accounts pay before the next payday or in 30 days. It holds recurring bills, bills typed in and connected cards' bills. An own transfer is no payment, so it is not in it.",
    source: { file: "analysis/ahead.ts", fn: "aheadBasis", field: "dueCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto", "Laskut"],
  },
  rareBillsYear: {
    name: "Harvemmin kuin kuukausittain 12 kk",
    definition: "The bills that come every second month or less often, found in the history or typed in, over the twelve calendar months from the one of today, a bill paid this month included. It leaves out a bill that a card or an account the balance does not count pays, as the bills of the same page do. Laskut and the report of rare bills read the one figure.",
    source: { file: "reports/bill-calendar.ts", fn: "billCalendar", field: "yearlyCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Laskut"],
  },
  essentialBills: {
    name: "Asuminen ja välttämättömät",
    definition: "The bills still to pay in a month of Laskut that the household cannot do without: housing, utilities, insurance, telecom, taxes and fees, and the regular bills of Lapset (day care and the like). One of the four kinds (`costKindOf`) that add up to the month's bills, to the cent.",
    source: { file: "reports/bill-calendar.ts", fn: "billCalendar", field: "essentialCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Laskut"],
  },
  debtBills: {
    name: "Lainojen ja korttien erät",
    definition: "The loan payments and card bills still to pay in a month of Laskut, and any other debt service. It is never optional. One of the four kinds that add up to the month's bills.",
    source: { file: "reports/bill-calendar.ts", fn: "billCalendar", field: "debtCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Laskut"],
  },
  contractBills: {
    name: "Leasing ja jäsenyydet",
    definition: "The bills still to pay in a month of Laskut that a fixed contract makes: car leasing and memberships. One of the four kinds that add up to the month's bills.",
    source: { file: "reports/bill-calendar.ts", fn: "billCalendar", field: "contractCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Laskut"],
  },
  optionalBills: {
    name: "Valinnaiset",
    definition: "The bills still to pay in a month of Laskut that are none of the other three kinds: subscriptions and every other bill, a bill with no category included. One of the four kinds that add up to the month's bills.",
    source: { file: "reports/bill-calendar.ts", fn: "billCalendar", field: "optionalCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Laskut"],
  },
  ownTransfers: {
    name: "Siirrot omille tileille",
    definition: "Regular transfers from the counted accounts to accounts the balance does not count, in the same window as Erääntyvät maksut. They leave the balance and are no payments.",
    source: { file: "analysis/ahead.ts", fn: "aheadBasis", field: "transferCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto"],
  },
  free: {
    name: "Käytettävissä",
    definition: "The balance of the counted accounts today less Erääntyvät maksut, Siirrot omille tileille and what the connected cards owe today that no bill of Erääntyvät maksut holds and that falls due before the payday. A card's whole debt is taken off when its next bill falls before the payday or is not known, so no day is guessed; a debt whose next bill falls on the payday or later is paid from the coming pay and is taken off nothing. A card with no balance leaves the figure unsaid.",
    source: { file: "analysis/ahead.ts", fn: "aheadBasis", field: "freeCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto"],
  },
  runway: {
    name: "Jää palkkapäivänä",
    definition: "What the counted accounts hold on the day before the next payday: today's balance less Käytettävissä's payments and own transfers and less the everyday spending expected on the days to the payday that the accounts pay themselves, with a range from the lower to the upper quartile of the base months. A card's purchases are taken off once, with the bill that pays them. A bill in the window holds the purchases made, and for a card paid in full also those expected up to its day. Later purchases wait for a bill after the payday. Without a known payday, a balance or three complete months the answer says why and gives no figure.",
    source: { file: "analysis/runway.ts", fn: "runwayOf", field: "leftCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto"],
  },
  lowPoint: {
    name: "Alin saldo edessä",
    definition: "The lowest balance the counted accounts reach in the next days, past the next payday: today's balance walked through the bills, loan payments and regular savings of the bill calendar and the pays from their own day on, less the everyday spending expected on the days before each point, as Jää palkkapäivänä takes it off. The range is the lowest balance with the base months that spent the most to the one with those that spent the least. Without a known payday, a balance or three complete months the answer says why and gives no figure.",
    source: { file: "low-point.ts", fn: "lowPoint", field: "cents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto"],
  },
  everyday: {
    name: "Arkimenot päivässä",
    definition: "The expected everyday spending of a day over every account in view. A card's purchases are in it. It is the mean of the complete months before the month: six at most, three at least. Subscriptions, bills, card bills and one-off purchases are left out (ADR 0021).",
    source: { file: "analysis/expected.ts", fn: "expectedEverydayPerDay", field: "cents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto"],
  },
  allowance: {
    name: "Käytettävissä päivässä",
    definition: "Käytettävissä spread over the days from today to the day before the next payday, today included: what each of those days may cost for the payments to stay covered. Nothing without a payday to count to or with nothing free. Arkimenot päivässä is what the days are expected to cost, this is what they may.",
    source: { file: "home.ts", fn: "homeRunway", field: "allowancePerDayCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto"],
  },
  paceGap: {
    name: "Ero odotettuun",
    definition: "What the month has cost so far less what it is expected to have cost on the same day (Odotettu), both as the first page's Menot count spending: a debt paid from a savings account is in neither. Above zero the month is dearer. Its three largest categories and the rest add up to it to the cent.",
    source: { file: "home.ts", fn: "homePace", field: "diffCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto"],
  },
  paceEnd: {
    name: "Menot kuun lopussa",
    definition: "A point estimate of the running month's Menot at its end: what the month has cost so far plus the expected spending (Odotettu) on the days left, held within the range from the lower to the upper quartile of the base months. Nothing on the last day of the month or without an expected month.",
    source: { file: "home.ts", fn: "homePace", field: "pointCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto"],
  },
  usualSpend: {
    name: "Tavalliset menot",
    definition: "The row of Varat ja velat: the expected spending (Odotettu) of the running month, all its days, so the buffer and the row read one figure. One-offs are left out.",
    source: { file: "home.ts", fn: "homeDirection", field: "usualCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto"],
  },
  fixed: {
    name: "Kiinteät menot",
    definition: "The active subscriptions and bills a month: their spending and debt service. The card bill and a monthly saving are not in it.",
    source: { file: "commitments.ts", fn: "fixedMonthlyCents", field: "fixedMonthlyCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Laskut"],
  },
  expected: {
    name: "Odotettu",
    definition: "What the month is expected to cost, to the same day of the month: the sum of the categories' expected figures, so every page that shows the month, a category or a bar adds up to it (ADR 0021). A category is the mean of the complete months before the month (up to six, at least three), a bill that comes every three months or less often is expected in its own month and a one-off purchase over 150 euros in a category that is rare is left out. Tavallisesti is gone from the pages.",
    source: { file: "analysis/expected.ts", fn: "expectedSpending", field: "expectedSpending" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto", "Raportit"],
  },
  income: {
    name: "Tulot",
    definition: "All the income the rows of the period count, earned or not: Ansiotulot and the rest (money from people, tax refunds, income of an unknown type). Credit drawn, own transfers and the return of a purchase are not in it.",
    source: { file: "analysis/flows.ts", fn: "totalsOf", field: "incomeCents" },
    unit: "cents",
    scope: "own",
    additive: true,
    pages: ["Raportit"],
  },
  earnedIncome: {
    name: "Ansiotulot",
    definition: "The income of the month that is earned: every income row except money from people, refunds, tax refunds and income of an unknown type. It is what Tavalliset tulot is the mean of.",
    source: { file: "analysis/usual.ts", fn: "earnedIncome", field: "earnedIncome" },
    unit: "cents",
    scope: "own",
    additive: true,
    pages: ["Raportit"],
  },
  usualIncome: {
    name: "Tavalliset tulot",
    definition: "The mean earned income (Ansiotulot) of the six complete months before the month, at least three. Money from people and refunds are left out. The yardstick of the income shares of the findings. A mean on purpose (ADR 0021): Säännölliset tulot is the median of the regular series and has its own name.",
    source: { file: "analysis/expected.ts", fn: "expectedIncome", field: "expectedIncome" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Raportit"],
  },
  regularIncome: {
    name: "Säännölliset tulot",
    definition: "The median regular income of the six complete months before the month, as many as three. The same months as Tavalliset tulot, so the period is one. It counts regular series only, so the two differ and keep two names.",
    source: { file: "reports/income.ts", fn: "incomeReport", field: "medianCents" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Raportit"],
  },
  buffer: {
    name: "Puskuri",
    definition: "The balance of the savings and checking accounts, less the debt on credit cards and the bills due before the next payday, in months of the expected month's spending and loan payments.",
    source: { file: "reports/buffer.ts", fn: "bufferReport", field: "bufferMonths" },
    unit: "months",
    scope: "own",
    additive: false,
    pages: ["Yhteenveto", "Raportit"],
  },
  balanceChange: {
    name: "Saldomuutos",
    definition: "How far the total of the account balances moved from the close of the day before the range starts to the close of its last known day, so the rows of the first day are in it. Without a known balance the day before, it starts from the close of the first month end at which every account is known (the first known day when no month end in the range is known), and the answer names that day.",
    source: { file: "reports/balances.ts", fn: "balanceReport", field: "change" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Raportit"],
  },
  netWorth: {
    name: "Varat velkojen jälkeen",
    definition: "The account balances less the debts of the household: the cards used and the loans left.",
    source: { file: "holdings.ts", fn: "buildHoldings", field: "netCents" },
    unit: "cents",
    scope: "own",
    additive: true,
    pages: ["Yhteenveto", "Raportit"],
  },
  cash: {
    name: "Säästö- ja käyttötilien saldo",
    definition: "The balance of the savings and checking accounts today. Cards and loans are not in it; Varat velkojen jälkeen takes the card debt and the loans off it.",
    source: { file: "holdings.ts", fn: "buildHoldings", field: "accountsCents" },
    unit: "cents",
    scope: "own",
    additive: true,
    pages: ["Yhteenveto", "Raportit"],
  },
  loanMonthly: {
    name: "Kuukausierä",
    definition: "What a loan costs a month, the viewer's part of it: the instalment of a loan on a shared account is cut by the viewer's part, and the bank's whole payment only names the loan (ADR 0016). Nothing for a loan whose payments are not known.",
    source: { file: "holdings.ts", fn: "buildHoldings", field: "monthlyPaymentCents" },
    unit: "cents",
    scope: "own",
    additive: true,
    pages: ["Yhteenveto", "Raportit"],
  },
  debtRate: {
    name: "Todellinen korko",
    definition: "The yearly rate at which the payments of a debt still to come, fees in, pay off what is owed today, compounded monthly to a year and held in thousandths of a percent. It counts from today, not from the day the credit was drawn, so it differs from the legal todellinen vuosikorko. Nothing comes off for a tax deduction. Not known, never 0, when the plan or the rows tell no rate; the debt's class (free, cheap, dear, very dear) follows it.",
    source: { file: "debt-cost.ts", fn: "debtCost", field: "rateMilli" },
    unit: "share",
    scope: "own",
    additive: false,
    pages: ["Raportit"],
  },
  debtCost12: {
    name: "Korot ja kulut 12 kk",
    definition: "The interest and fees of the payments of the 12 months after today, of every debt that owes, the viewer's part of each. The parts add up to it: the interest and the fees. Not known, never the sum of the others, while any debt lacks its terms: one that owes and has no cost, or a loan or card the rows show that nobody saved. It is what the debts will cost, where Korot ja luottokulut is the interest and fees already paid.",
    source: { file: "reports/loans.ts", fn: "loansReport", field: "cost12" },
    unit: "cents",
    scope: "own",
    additive: false,
    pages: ["Raportit"],
  },
  periodLeft: {
    name: "Käteen jäi",
    definition: "Tulos of the range, the running month in it. The month rows of Tulot ja menot add up to it, and so does the headline of Tulot.",
    source: { file: "reports/cashflow.ts", fn: "cashflowReport", field: "whole" },
    unit: "cents",
    scope: "own",
    additive: true,
    pages: ["Raportit"],
  },
} as const satisfies Record<string, Figure>;

