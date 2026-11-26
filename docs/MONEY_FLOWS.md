# How transactions are counted

Every transaction lands in exactly one flow, so nothing is counted twice or left out.

| Flow | Means | Shown as |
|---|---|---|
| Kulutus (spending) | goods and services | Menot, categories, merchants |
| Velanhoito (debt) | loan payments, financing, interest, collection | part of Menot, own group in reports |
| Säästöt (savings) | savings accounts, funds, shares, crypto, gold, pension savings | savings rate, cash flow |
| Tulot (income) | salary, benefits, tax refunds, dividends, sales, refunds of costs | Tulot |
| Luotonnostot (borrowing) | credit drawn to an account, loan payouts | cash flow and *Tulos*, never income |
| Siirto (transfer) | money between your own connected accounts | not counted |

## Definitions

A figure has one definition, in `packages/core`, and the first page, the reports and Laskut all use it. `packages/core/src/figures.ts` lists the figures by the name the pages show, with the function that computes each. One name means one figure. Two figures that differ get two names: *Erääntyvät maksut* is the payments to the payday, and *Seuraavat 30 päivää* on Laskut is what the accounts pay in the next 30 days. A regular transfer to an account the balance does not count is no payment: it is *Siirrot omille tileille*, a line of its own. *Tavalliset tulot* and *Säännölliset tulot* read the same six months, save the month a credit card was connected in: only *Säännölliset tulot* reads it. *Odotettu* is the one figure of what a month costs and has replaced the name *Tavallisesti* ([ADR 0021](adr/0021-expected-figure.md)). The limits the figures read are in `packages/core/src/thresholds.ts`, each with its unit and reason ([ADR 0020](adr/0020-figures-and-thresholds.md)).

| Word | Means | In core |
|---|---|---|
| *Valmis kuukausi* | A month that has ended and that the history covers from the 1st. The running month and a first, partly fetched month are not complete. Neither is a month whose rows are missing: one or two months with no row at all, between months with rows, on an account in daily use (8 rows a month or more on average, spending in 85 % of the months it has rows in, and rows in three of four months from its first row to its last). The bank or the file missed them, so they are no months at 0 €. Such a month is incomplete for that account, and for the household when the account carries over 10 % of its spending. The usual level skips one such run and reads the months on both sides of it. The income report judges a month by the accounts other than credit cards: income comes to a card mostly as refunds, so the month a card was connected in holds all the income. Every income figure reads that judgement: the report's `complete` flag, the median of regular income and the months of Tavalliset tulot (`completeIncomeMonthsBefore`, which skips one run of missing rows as the usual spending level does) | `isCompleteMonth` in `analysis/usual.ts`, `rowsMissing` in `analysis/coverage.ts`, `isCompleteIncomeMonth` for the income figures |
| *Odotettu* | What the month is expected to cost, in whole cents, made per category and added up: the headline is the sum of the categories, so the waterfall's bars and the change report's rows add up to it. The base is the last six complete months before the month in question, none under three. A category is the mean of what those months had spent by the same day. A bill or subscription that comes every three months or less often is expected whole in the month it falls due and in no other. An active monthly bill stands at its latest amount. A one-off (the level policy, ADR 0005) is left out and listed. The month a credit card is connected in is skipped when the month before it paid card bills, never the months before it: their card bills held the card's purchases. A month in which accounts joined late is also skipped, and the months before it still read, when those accounts carry under `LEFT_OUT_SHARE` (10 %) of the spending from that month to the month before, whatever their type. When any base month holds a card bill that is no transfer (a card never connected, or connected later and paid by bills before) or comes before the history of a linked card, the headline is true and the categories are not. The page shows the headline and leaves out the bars and the estimate. One line says why. Month totals are not affected, a bill counts as spending. The pages name the base: *odotettu 2 825 € (6 kuukauden keskiarvo)*. The buffer divides by this figure for the running month, all its days | `expectedSpending`, `expectedFor`, `expectedOf` in `analysis/expected.ts`. `completeMonthsBefore`, `cardsBreakUsual` in `analysis/usual.ts` |
| *Ansiotulot* | The income of a month that is earned: every income row except money from people, refunds, tax refunds and income of an unknown type (`INCOME_TYPES.unknown`), which the income report shows apart. Yhteenveto's Tulot shows it under its figure when it differs from *Tulot*, and the income line of Kuukausi reads it | `earnedIncome` in `analysis/usual.ts`, `isEarnedIncome` in `analysis/income.ts` |
| *Tulot* | All the income the rows of a period count, earned or not: *Ansiotulot* and the rest. Credit drawn, own transfers and the return of a purchase are not in it. Yhteenveto's Tulot and the month table of the income report show the same figure for a month (`monthIncome` in `analysis/usual.ts`) | `PeriodTotals.incomeCents`, summed in `totalsOf` in `analysis/flows.ts` |
| *Kuukausierä* | What a loan costs a month, the viewer's part of it. The bank's whole payment only names the loan (ADR 0016) | `monthlyPaymentCents` in `holdings.ts` |
| *Todellinen korko* | The yearly rate at which a debt's payments still to come, fees in, pay off what is owed today (compounded monthly to a year, held in thousandths of a percent). It counts from today and not from the day the credit was drawn, so it is not the legal todellinen vuosikorko, and no tax deduction comes off it: the interest of home and student loans is not deductible. Unknown, never 0, when the plan or the rows tell no rate. The class of a debt follows it: free (the payments cost nothing over what is owed), under 7 %, under 15 %, 15 % or more. Raportit > Lainat lists the debts that cost something by it, highest first, then by class, then the debts with no rate, and a debt that is free (Maksuton) last | `rateMilli` of `debtCost` in `debt-cost.ts` |
| *Korot ja kulut 12 kk* | The interest and fees of the payments of the 12 months after today, of every debt that owes, the viewer's part of each. It is the sum of the rows of Raportit > Lainat and splits into interest and fees where the evidence splits a payment; it is unknown, never 0 and never the sum of the others, while any debt lacks its terms: one that owes and has no cost, or a loan or card the rows show that nobody saved. It is what the debts will cost; *Korot ja luottokulut* is what the debt service of a past range held | `cost12` of `loansReport` in `reports/loans.ts` |
| *Tavalliset tulot* | The mean earned income of the last six complete income months (*Valmis kuukausi* as the income report judges it) before the month in question, in whole cents, and none under three. Earned income is every income row except money from people, refunds, tax refunds and income of an unknown type (`INCOME_TYPES.unknown`), which the income report shows apart. Several figures divide by this one: the buffer report, the fixed costs and debt service shares, the overview and *Tilanne* on Säästövinkit. Their sentences name the same income. The income line of Kuukausi reads the month's earned income and this figure through `IncomeMonth.earnedCents` and `usualCents` in the income report. Yhteenveto's Tulot has no usual figure, so it has no usual line | `isEarnedIncome` in `analysis/income.ts`, `expectedIncome` in `analysis/expected.ts` |
| *Säännölliset tulot* | The median regular income of the last six complete months, none under three. It is the figure of *Säännölliset tulot kuussa* in Raportit > Tulot ja menot and is shown nowhere else. It counts regular series only, so it has its own name beside *Tavalliset tulot* | `incomeReport(...).stability.medianCents` in `reports/income.ts` |
| *Säästöaste* | Saved / income, where saved is the savings flow (savings categories and transfers into your own savings accounts). It is negative when savings were drawn on and empty without income. A running period tells it from its complete months (`settled` in the dashboard) | `PeriodTotals.savingsRate` in `analysis/flows.ts` |
| *Käteen jäi* | Tulos of the range, the running month in it: income and credit drawn, less consumption, debt service and saving. The headline of Tulot, the month rows of Tulot ja menot with its total row, and the sentence under them are this one sum, so they are the same figure on one page. Only the savings rate of a running range is told from its complete months | `cashflowReport(...).whole` in `reports/cashflow.ts` |
| *Tulos* | Income + credit drawn − spending − saved: what stayed on the accounts. Negative when the accounts were drawn on. See *Tulos and borrowed money* | `PeriodTotals.leftCents`, summed in `totalsOf` in `analysis/flows.ts` and nowhere else |
| *Menot* | Consumption and debt service of a period, net of refunds: everything that left for good. Saving and own transfers are not in it | `PeriodTotals.expenseCents`, summed in `totalsOf` in `analysis/flows.ts` |
| *Kulutus* | Goods and services of a period, net of refunds: *Menot* less the debt service | `PeriodTotals.consumptionCents`, summed in `totalsOf` in `analysis/flows.ts` |
| *Säästöön siirretty* | The savings categories and the transfers into the household's own savings accounts, less what was taken out of them | `PeriodTotals.savedCents`, summed in `totalsOf` in `analysis/flows.ts` |
| *Erääntyvät maksut* | What the counted accounts pay before the next payday or in 30 days: recurring bills, bills typed in and the bills of connected cards. An own transfer is no payment, so it is not in it | `dueCents` in `aheadBasis` in `analysis/ahead.ts` |
| *Harvemmin kuin kuukausittain 12 kk* | The bills that come every second month or less often, found in the history or typed in, over the twelve calendar months from the one of today. A bill paid this month is in it, so the figure holds all month. It leaves out a bill that a card or an account the balance does not count pays, as the bills of the page do | `yearlyCents` in `billCalendar` in `reports/bill-calendar.ts` |
| *Asuminen ja välttämättömät* | The bills still to pay in a month of Laskut that the household cannot do without: housing, utilities, insurance, telecom, taxes and fees, and the regular bills of *Lapset* (day care and the like). One of four kinds that add up to the month's bills (*Cost kinds of the bills*, below) | `essentialCents` in `billCalendar` in `reports/bill-calendar.ts`, the kind in `costKindOf` in `cost-kinds.ts` |
| *Lainojen ja korttien erät* | The loan payments and card bills still to pay in a month of Laskut, and any other debt service. Never optional | `debtCents` in `billCalendar` in `reports/bill-calendar.ts` |
| *Leasing ja jäsenyydet* | The bills still to pay in a month of Laskut that a fixed contract makes: car leasing and memberships | `contractCents` in `billCalendar` in `reports/bill-calendar.ts` |
| *Valinnaiset* | The bills still to pay in a month of Laskut that are none of the other three: subscriptions and every other bill, one with no category too | `optionalCents` in `billCalendar` in `reports/bill-calendar.ts` |
| *Siirrot omille tileille* | Regular transfers from the counted accounts to accounts the balance does not count, in the window of *Erääntyvät maksut*. They leave the balance and are no payments | `transferCents` in `aheadBasis` in `analysis/ahead.ts` |
| *Käytettävissä* | The balance of the counted accounts today less *Erääntyvät maksut*, *Siirrot omille tileille* and what the connected cards owe today that no bill holds. A card's whole debt is taken off, so the day its bill falls is not guessed. A card with no balance leaves the figure unsaid | `freeCents` in `aheadBasis` in `analysis/ahead.ts` |
| *Jää palkkapäivänä* | What the counted accounts hold on the day before the next payday: today's balance less the payments and own transfers of *Käytettävissä* and the everyday spending expected on the days to the payday, with a range from the lower to the upper quartile of the base months. A card that is not connected and shows only as its bills is a card with a known next bill: that bill is in *Käytettävissä*, and its purchases spread over the base months (*Arkimenot päivässä*) are taken off nothing, as they wait for a bill after the payday. Empty without a known payday, a balance or three complete months | `leftCents` in `runwayOf` in `analysis/runway.ts` |
| *Alin saldo edessä* | The lowest balance the counted accounts reach in the next 60 days, past the next payday. It starts from the figure *Käytettävissä* starts from: the balance less the debt of the cards that no bill of the payday window holds, taken off whole from today. It is walked through the bills, loan payments and regular savings of the bill calendar and the pays, a pay counting from its own day and a payment on that day met before it, less the everyday spending expected on the days before each point as *Jää palkkapäivänä* takes it off. A card's purchases leave with its next bill and, after that bill or with none to come, day by day. With no everyday spending it is the lowest point of *Erääntyvät maksut*, and inside the payday window the top of its range is never above *Jää palkkapäivänä*. The day is the lowest one of the expected spending, and the range runs from the base months that spent the most to those that spent the least. A base month that holds a card's purchases only as a bill gives the bill's sum spread over its days, so a card paid by bills is no reason to leave the figure out. Such a card's bills in the payday window and the 30 days of Laskut are walked on their days and hold its purchases up to the last of them, and its purchases after that day are taken off day by day. Every payment of such a card's bill in the base months waits for that day, whether its series holds it or not, as *Jää palkkapäivänä* leaves every card bill out of the everyday spending. Empty without a known payday, a balance or three complete months, or while a bill, loan payment or saving has no known sum and falls within the 60 days or has no known day, and the reason says which. An unknown bill after the last day, one a card pays and a pay with no known sum leave the figure, as none of them can lower it | `cents` in `lowPoint` in `low-point.ts` |
| *Arkimenot päivässä* | The expected everyday spending of a day over every account in view, cards' purchases included: the mean of the complete months before the month, six at most and three at least. Subscriptions, bills, card bills and one-off purchases are left out (ADR 0021). A base month that holds a card's purchases only as a bill gives the bill's sum spread over its days instead, unless the card the bill names has rows in that month | `expectedEverydayPerDay` in `analysis/expected.ts` |
| *Käytettävissä päivässä* | *Käytettävissä* spread over the days from today to the day before the next payday, today included: what each of those days may cost for the payments to stay covered. Empty without a payday to count to or with nothing free | `allowancePerDayCents` in `homeRunway` in `home.ts` |
| *Ero odotettuun* | What the month has cost so far less what it is expected to have cost on the same day (*Odotettu*), both counted as *Menot* count spending: a debt paid from a savings account is in neither. Above zero the month is dearer. Its three largest categories and the rest add up to it to the cent | `diffCents` in `homePace` in `home.ts` |
| *Menot kuun lopussa* | A point estimate of the running month's *Menot* at its end: what the month has cost so far plus the expected spending (*Odotettu*) on the days left. It lies in the range from the lower to the upper quartile of the base months. Empty on the last day of the month and without an expected month | `pointCents` in `homePace` in `home.ts` |
| *Tavalliset menot* | The row of Varat ja velat: the expected spending (*Odotettu*) of the running month, all its days, so the buffer and the row read one figure. One-offs are left out | `usualCents` in `homeDirection` in `home.ts` |
| *Puskuri* | The balance of the savings and checking accounts, less the debt on credit cards and the bills due before the next payday, in months of the expected month's spending and loan payments. Yhteenveto shows it at the foot of Varat ja velat as *Puskuri 1,4 kk*, with the two sums it divides in a drill. Debts and bills above the cash make it negative, never zero. Without a balance (*Ei saldoa*), with fewer than three complete months (*Liian lyhyt historia*) or with an expected month that costs nothing (*Ei menoja*) it is no figure, and `bufferGap` says which | `bufferMonths` in `bufferReport` in `reports/buffer.ts` |
| *Saldomuutos* | How far the total of the account balances moved from the close of the day before the range starts to the close of its last known day, so the rows of the first day are in it. Without a known balance the day before, it starts from the close of the first month end at which every account is known (the first known day when no month end in the range is known), and the answer names that day | `change` in `balanceReport` in `reports/balances.ts` |
| *Varat velkojen jälkeen* | The account balances less the debts of the household: the cards used and the loans left | `netCents` in `buildHoldings` in `holdings.ts` |
| *Säästö- ja käyttötilien saldo* | The balance of the savings and checking accounts today. Cards and loans are not in it; *Varat velkojen jälkeen* takes the card debt and the loans off it | `accountsCents` in `buildHoldings` in `holdings.ts` |
| *Katettu luotolla*, *Katettu säästöistä*, *Tileiltä tai kortilta* | How a period that took more than its income was paid for: with credit drawn in the period, with money taken out of savings, and the rest from the accounts or a connected card, which the totals cannot tell apart. `coverOf` also gives what the drawn money left (`creditLeftCents`, `savingsLeftCents`), so no view subtracts | `coverOf` in `analysis/flows.ts` |
| *Kuussa*, *vuodessa* (a series) | What a subscription or bill costs: its typical charge times the charges it makes in a year, and a twelfth of that a month. A monthly series with a year of history counts its own charges of the last twelve months (11 for day care that is free in July), and a bill that varies (electricity) is what its last twelve charges came to. The monthly payment of a loan or credit is its regular instalment: an extra payment is optional and is no monthly cost. A charge over twice the median of a series with a regular level, or a run of them, after which the series is back at that level (a repayment of a loan's capital between instalments) sets no typical charge, and a year with one costs the typical charge for each of its charges for a loan or credit, while any other bill counts the one-off as one typical charge and keeps its other charges. A lender's row on an instalment's due day fills that month as one instalment, so the instalments stay a year of payments; a card bill or a bill whose sum moves every month has no regular level and keeps every charge. Fixed costs, new subscriptions, renewals and price rises read these figures, and so does Säästövinkit: its 120 € gate for a renewal is the series' own year, and its follow-up counts the series' own charges a year | `RecurringSeries.perMonth`, `monthlyCents`, `yearlyCents` in `recurring.ts` |
| *Kiinteät menot* | An active subscription or bill, per month: its spending and its debt service (a loan instalment). The credit card bill is left out, since it pays everyday purchases, and so is a monthly saving | `isFixedCost`, `fixedSplit`, `fixedMonthlyCents` in `commitments.ts` |
| *Tilaus* | An active fixed-amount series in subscriptions, fitness, entertainment, education, shopping or other. Telecom, insurance, housing, utilities, memberships and loans are contracts: they are fixed costs and are not subscriptions | `isSubscription`, `subscriptionsMonthlyCents` in `commitments.ts` |
| *Sopimus* | A fixed cost that is not a subscription, spending or debt service only: phone, insurance, housing, utilities, day care, a loan instalment. *Sopimukset ja laskut* and *Tilaukset* add up to *Kiinteät menot*, the figure of Laskut | `isContract`, `contractsMonthlyCents` in `commitments.ts` |
| *Säännöllinen säästäminen* | An active monthly saving, such as a fund saving plan. It leaves the account like a bill, but the money is kept, so it is neither a fixed cost nor a contract. Laskut shows it on a card of its own | `isSavingsPlan`, `savingsPlansMonthlyCents` in `commitments.ts` |
| *Kuussa* (a merchant) | A merchant with an active series shows that series' figures per month and year. Any other merchant: its money out over the last 12 complete months, own transfers left out, divided by their number, and empty unless money went out in at least three of those months, so a one-off purchase has no figure. Kauppiaat and the merchant summary show this one figure, whatever the period. Kauppiaat leaves out the card bills of a card that is not connected: a bill pays purchases and is no merchant | `merchantBasis`, `merchantMonthly` in `commitments.ts` |
| *Odotettu lasku* | A bill the household typed in, repeated by its cadence: once, quarterly, half yearly or yearly | `ExpectedBill`, `expectedDates` in `commitments.ts` |

Monthly averages divide by complete months only, so a running month never pulls an average down. A category or pivot
average without one complete month is empty. A year comparison needs three whole months in both years. A period that ends mid-month is set against the same days a year earlier, in the month's line as in the year's figures. Money saved to an
own account or fund that is not connected (`own_unconnected` in Tietojen laatu) counts as saved, and the data quality card
names the sum and the largest payees, so a missing connection shows.

Tapahtumat's strip leaves own transfers out of its sums, and so does a merchant summary's category. The row
count still includes them. A merchant summary's Menot yhteensä and Tulot yhteensä are the same flows over all the
merchant's rows, so a refund lowers Menot there too and adds nothing to Tulot. The strip adds up the flows of the rows (`totalsOf` over the `flows` of the context, as the
first page does), so a refund lowers Menot, the rows of a loan account and the moves between own accounts are neutral, a
short payment's fee is spent, and what lands on savings is saved. It names that sum *Säästöön siirretty* (or *Otettu
säästöistä* when it is negative), as an amount with no sign, since the name says the direction. Erotus less that sum is Tulos
of the same rows, and the strip tells it after that term (`leftCents` of `totalsOf`, not added up in the browser) when it
differs from Erotus, and then in place of Erotus, which it nearly repeats. When it is the same as Erotus only Erotus is shown.
The chart's count for a day is the rows that spend (Menot) or bring in (Tulot), as the lead above the list counts them. The days of the list and its
histogram add up the same flows by booking day, so the bars add up to the strip. A card bill whose statement is read
stands at what its rows leave of it, and the purchases of the statement stand on their own days, as on the first page,
unless a filter narrows the list. While a listed row is newer than the figures they come from, the strip tells no sum
and says it is updating.

The same words show the same euros: *Säästöön siirretty*, *Otettu säästöistä*, *Nostettu luottoa* and *Luottoa maksettu
takaisin* in Tulojen käyttö are the whole euros of the terms under Tulos. A term the rounding would turn to the other
direction or to nothing is not shown.

One month has one result. On the first page the terms under Tulos add up: Tulot less Menot, less what moved to savings
(or more, what was taken out of them), more credit drawn (or less, credit paid back) is Tulos. The list of Tulojen käyttö
holds what was taken out of savings or drawn on credit and stayed as money in beside the income, so its parts add up to the
income and that money, and their shares to 100 (`bridgeView`). With a gap, where the income did not pay everything, the
list names none of it, so a name never stands for two sums. The terms are rounded with Tulot, Menot and Tulos, so the
euros shown add up. The cash flow report's row of the month has the same Tulos
(`leftCents`) and the same difference of income less consumption and debt service. `monthResult` in
`packages/core/test/kit/invariants.ts` holds all of it for every generated household.

## The debt service in its parts

`debtSplit` in `analysis/debt-split.ts` tells the debt service of a range (`PeriodTotals.debtCents`) in three sums that add
up to it to the cent: interest and fees (*Korot ja luottokulut*), repayments (*Lyhennykset*) and what no evidence splits
(*Velanhoito, erittelemättä*). Each debt row counts once, in one of them. The evidence, in order: the payment parts a
loan document stated (the payment of a part's due date, within `LOAN_ROW_DAYS`, when the parts add up to the row within
the tolerance; the interest and the fee are the document's cents and the rest repays); the interest rows the
connected loan account booked on the day of the payment (not when the payer's account has a row of interest of its own
that day); the plan of a saved loan whose payment series holds the row,
within `LOAN_ROW_DAYS` of a due date and the tolerance of the payment the plan expects (the known fee is a cost, the rest
repays); otherwise the row stays unsplit. A row of the category `interest` is interest as a whole, and a card bill and a
collection row are never split. An unknown part is never counted as 0. *Tulos* stays cash and no total moves (ADR 0028):
Yhteenveto shows the sums, in the order Tulot, Kulutus, Korot ja luottokulut, Velanhoito, erittelemättä (when it is
not 0), a subtotal of the income less these costs, Lyhennykset, the rows for saving and credit, Tulos. The cash flow
report data carries them too, and no page shows them there yet.

The interest of the tax-year sheet (`taxYearReport`, Asetukset > Tiedot > Verovuoden rivit) is the interest of home and student loans
alone: the interest rows that pay a saved home or student loan, and the interest part (the fee left out) of each row of
the categories `mortgage` and `student_loan` that the same evidence splits (`debtRowParts`). A payment row that reaches
a saved loan whose interest the bank booked as a row of its own in the same calendar month holds no interest. The sum
is unknown, never 0, while an interest row reaches no saved loan or any other home or student loan payment of the year
is not split. A year with none of these rows reads 0.

## Tulos and borrowed money

*Tulos* is what a period left on the accounts: income + credit drawn − spending − debt service − saved (ADR 0014).
`totalsOf` holds the sum, and the first page and the cash flow report read `leftCents` from it. The figure is the same
number the rows give with no flow in between: the sum of every row on an account that is not a loan, less the transfer
rows (a pair cancels itself, so this takes away the legs with no other half in the period), less the money moved into
savings accounts, which is *Säästöön*. A card account is in the sum, since a card purchase is spending on the day it is
made. `packages/core/test/totals.test.ts` holds this to the cent for the demo, the seeded households and random rows.

A loan paid from a savings account is counted once in Tulos: as *Säästöön* when the money leaves the pool, and not again
as debt service when the savings account pays the lender. The row has no flows, so it is left out of the figures built
from them: Tulos, the income, spending and difference of its identity (`totalsOf`) and the savings rate. The first page
reads those figures too: its Menot figure, the month's curve, the Menot of *Tulot ja menot*, the usual month's line on
its bars (`usualSpendCents`, from `typicalFlowCents` of *Menot kuukausittain*), the pace and the usual it is set against
(`expectedFlowsFor`), the spending goal and the explanation of the tile are the spending of the flows (`flowSpendOf`,
`overview.months`), so income less spending is the difference and less what went to savings is Tulos, with no
exception. Every figure under Menot reads that one base, and `packages/core/test/menot-base.test.ts` holds it: the same
household with and without a loan paid from savings gives the same Menot figures. The row is still spending on its own terms (`spend` of the row, `spendCentsOf`), so it is in
the category totals, Velanhoito, spending by month and year over year, the tax-year interest and loan payments and the
instalment interest, and it is a row of Laskut and the loan views. The spending total of the identity is therefore
less than the sum of the categories by exactly these rows. Where a spending report's total stands beside the first
page's Menot, it names them as *Säästöistä maksettu* (`fromSavings` of *Menot kuukausittain*, `fromSavingsCents` of the
first page's categories) and shows the line only when the sum is not zero.

Credit drawn (*Luotonnostot*) is money on the account that is not income. It is in *Tulos* and in no income figure,
savings rate or margin (`netCents`).

When a period took more than its income, `coverOf` says how the gap was paid. Money has no label, so the order is a
rule: the income pays first, then the credit drawn in the period (*Katettu luotolla*, at most the credit drawn), then
money taken out of savings (*Katettu säästöistä*), then the accounts and the connected cards (*Tileiltä tai kortilta*,
which is how far *Tulos* is below zero). The third cover never says that money on an account paid: an account may
have grown while a card owed more, and `PeriodTotals` holds no balance of either, so the tile and the sentence ("Ero
katettiin tileillä olleilla rahoilla tai luottokortilla.") name both. Credit goes before savings so that a month paid
with both never shows less borrowing than there was. Drawn money that paid for nothing is in *Tulos*. The bridge (`bridgeView` in core) is one sum, and its parts are parts of it:

    income + credit drawn + savings drawn + from the accounts = spending + debt service + saved + credit paid back + Tulos above zero

A sentence on the covers names them with sums the figures show, and a credit line gives the credit drawn with the debt
service of the period under the tile's own word ("Luottoa nostettiin 20 000 €, velanhoitoon meni 1 200 €."). How much
of the credit is in *Tulos* is said only when no debt was paid in the period: with a payment beside it, the split is
true by the order rule alone. Neither calls borrowed money income, and neither says more was spent than earned
without saying how the difference was paid.

`bridgeView` marks a period as drawing (`draws`) only when there is income and no part is below zero: then every part is zero or
above and the parts are one sum on one axis. A period with no income, with refunds above purchases or with income taken
back has rows only, every one signed and the last *Tulos*, and nothing is told as a share of the income.

## Cases

| Case | Counted as | Why |
|---|---|---|
| Purchase with a credit card (e.g. Nordea Gold, Platinum, Mastercard) | spending, on the card account | purchases count where they happen |
| Card bill paid from the current account, card account connected | transfer, or a card bill (debt service) for a payment from before the card's rows begin | the purchases count once: on the card account, or in the bill when no row holds them. See *Card bills* |
| Same, card account not connected | debt service ("Luottokortin lasku", group Velanhoito) | the bill pays the card's credit; its purchases are unknown, so no purchase category gets them |
| Bill of another card of the same issuer (Platinum while only Gold is connected), or of another issuer's Gold | card bill (debt service) | only the connected card's purchases are counted on its account |
| Bill for a card that is not connected (e.g. Amex) while another card is | card bill (debt service) | only the connected card's bill is a transfer |
| Payment to a card issuer such as Nordea Rahoitus or Bank Norwegian | card bill if the text has a card word or names a connected card of the issuer (see *Card bills*); otherwise debt ("Kulutusluotot") | an instalment repeats, a card bill follows the purchases. A text with a loan word (*osamaksu*, *laina*) stays a loan, and one payment reference is one contract (see *Card bills*). A lender that issues cards and lends otherwise, paid in changing sums by its name alone, is a credit of unknown kind until the household tells its kind |
| A credit of unknown kind | debt ("Kulutusluotot"), mandatory debt service | Tarkistettavat asks whether it is a card, a credit line (*Joustoluotto*) or a consumer credit. Until then it is listed as a debt with its monthly payment and no balance, unless a credit saved with no link stands for it. A saved card loan linked to the series makes its payments card bills ("Luottokortin lasku"); saving, changing or deleting such a loan runs the categories again |
| Money into the card account ("Maksu, kiitos", prepaying) | transfer | money into a card is a payment, not income |
| Credit moved from a card to the current account | transfer if both are connected, otherwise borrowing | borrowed money is not income |
| Mortgage payment, or a loan payment text (*lainanmaksu*, *lyhennys*) to a bank that lends mortgages (Nordea, OP, Danske, S-Pankki, Aktia and others) | debt ("Asuntolaina") | other lenders' loans, such as a car or appliance instalment, are "Kulutusluotot" |
| A payment of the series a saved home loan is linked to, whatever the row says (a lender's name and a reference alone), and the payments before and after it that the rate moved (one a month, within 15 % of the payment before) | debt ("Asuntolaina") | the household's saved loan is the proof; a name or an amount alone never is, and another saved loan's rows stay as they are. Saving, changing or deleting such a loan runs the categories again |
| Mortgage account connected | its own rows are not counted, and the payment from the current account stays debt | the loan account only mirrors the payment |
| Payment to an own account the bank typed as a loan that pays shops (three purchases or more) | transfer | a joint current account listed as a loan; a loan account takes instalments and books interest |
| A housing company's charge for its own loan (*rahoitusvastike*, *yhtiölaina*, or a loan named by its purpose such as *remonttilaina*) | spending (housing), or debt when the text says *lyhennys* or *lainaosuus* | the company owes the loan and the shareholder pays a charge, so it is never proposed as a loan to save |
| Student loan, collection, late interest | debt | |
| Loan paid out to an account | borrowing | |
| To your own connected savings account | transfer, counted as saved on the savings side | the legs pair up to five days apart (`PAIR_WINDOW_DAYS`); a weekday the banks are closed between them does not count. A payee the bank gives as a Finnish account number is read as its IBAN |
| A payment that names a connected account of the household and arrives a little short | transfer for what arrived, both legs. The difference is the payer's bank fee, spending under *Pankkikulut*, where both legs are in the view; a view with one leg of it is unchanged, and the receiver's view asks about the money in (*Tarkistettavat*) | the fee is worked out on each run from the pair and stored nowhere. The money in lands on exactly the named account, within the window above, at most 2 % and at most 5 euro under the payment and never over it. The closest sum pairs, then the closest day. The name of the payer is not read (`pairing-fee.ts`) |
| "Oma siirto" to an account that is not connected | savings | |
| A payment to or from your own name with no matching row and no purpose in the text. Money in that names a payer account counts only when your own name sent money to that account | savings, so *Tulos* adds up and `own_unconnected` sees it; a pair found later makes it a transfer | the same reading as the bank's own code for such a move. Money in from an account your own name never paid may be a namesake's and is not counted as saved |
| Nordnet, funds, OST, crypto, investment gold | savings | |
| Selling investments back to the account | savings go down, not income | |
| Dividends, deposit interest | income ("Osingot ja korot") | |
| Salary, holiday pay | income ("Palkka") | |
| Kela, unemployment fund, pension, tax refund | income ("Etuudet") | |
| Insurance payout | income ("Hyvitykset") | premiums are spending ("Vakuutukset") |
| Back taxes, vehicle tax, fines, municipal fees | spending ("Verot, maksut ja sakot") | |
| Union or unemployment fund fee | spending ("Jäsenmaksut") | |
| Rent received from a tenant | income ("Muut tulot") | a sender who pays about the same amount in three or more months is regular income |
| Refund from a shop | spending goes down in the category of the purchase when the shop was paid in the 120 days before and the refund is not larger than what is left of those payments; otherwise it is income ("Hyvitykset") | a refund cancels a purchase, see *Money that comes back* |
| MobilePay to or from a person | spending / income ("Maksut henkilöille", "Maksut henkilöiltä") | names like Elisa or Helen are people here, not companies |
| Transfer to a person's account with no payment reference | spending ("Maksut henkilöille") | a gift or a share, not a sole trader's invoice. Money in is not read this way. See *People* |
| Money from another holder of your account (a partner), also when the bank calls it an own transfer | income that is not earned ("Maksut henkilöiltä") | it is her money, not your pay and not your saving. When the partner's account is one a member of the household connected (its IBAN is known), it is a transfer instead. See *People* |
| A limited company with a word of lending in its name that no list knows | paid: debt (finance, credit, loan, bank). Money in: borrowing, for finance, credit or loan only | a bank also pays pay and bonuses. See *Lenders* |
| Money out to the bank of a connected account, by its plain name | not debt by the name alone | a paper statement or a card bill paid by reference with sums that vary is no instalment: the same sum paid month after month under one reference is (see *Lenders*). The bank's finance company is a lender like any other |
| MobilePay to a business (name ends or starts with Oy, Ky, ry and the like, or holds a trade word such as a pizzeria) | spending in the business's category | a company form or a trade word in the payee name rules out a person, with the app's name in front of it or without |
| A card row through a payment service (PayPal, SumUp, Zettle, Klarna, Paytrail, Square, Stripe, Vipps, MobilePay ...) | filed by the shop behind the service: the text after the star or slash, or the word beside the reference in a Trustly row | the service stays as the line "Maksettu palvelun X kautta"; a row with no shop is asked once per service (`payment-services.ts`) |
| Tori.fi, Vinted, Huuto.net | income ("Myyntitulot") | |
| Cash withdrawal, also a row the bank types as a card payment ("Korttimaksu/Nosto") | spending ("Käteisnostot") | |
| Refund from the tax office | income ("Veronpalautukset") | not a benefit, and not pay |
| "Siirto tililtä" or "Siirto omalle tilille" with no other account to pair | transfer, not income and not saving | a savings account named in the text is saving, and a card's "luoton siirto omalle tilille" is credit drawn |
| Bank fees | spending ("Pankkikulut") | |
| Pending card payment | counted, replaced by the booked row on the next fetch | your own category choice moves with it |
| A bill paid from another account, or under a payee name typed by hand | the series' bill of that date is paid: it is no row of what is due, and the year of rare bills counts it as paid in its month. The paying row keeps its payee, category and account | the same payee and about the bill's sum, or the bill's payment reference, or the creditor's IBAN that the series' earlier rows carry; never the sum alone. See *Bills paid another way* |
| Money between members | transfer, in every view | it stays in the household, in *Koko talous* and in a member's own view alike. A movement to or from an account no member connected is money between people, see *Joint accounts* |
| Joint account connected by both | one copy in the *Koko talous* view, the viewer's own, whole. In a member's own view it is counted at the member's part | the copies are the same real account when the bank gives them one identity (its own hash, else the IBAN). See *Joint accounts* |

## How a row is read

A row is read in this order. Each step decides only what the steps before it left open, and a category you set by hand
is never changed.

1. The merchant name is worked out from the bank's fields (*Merchant names*).
2. The category rules, where the first match wins, in this order: your own rules, money to and from people
   (*People*), the rules of purpose (pay, benefits, loans, card bills, savings, fees, taxes), the bank's own code of the
   row, a person by the bank's word or by a payment with no reference, lenders by the shape of their name and the bank's
   own rows (*Lenders*), and last shops and the generic rules. The card's merchant code and the trade register come
   after the rules (ARCHITECTURE.md, *Structure*). A rule of yours with a category of spending reads money
   going out only: money coming in from the same payee is read by the other rules, and is income when none of them knows it.
   A refund that the other rules file under a category of spending stays in the category of your rule. A rule of debt reads
   money in as borrowing.
3. A payment to a card issuer is a loan or a card bill (*Card bills*).
4. Money that comes back is matched to its payment (*Money that comes back*).
5. Transfers: pairs of rows, a card's payment channel, the issuer fallback (*Card bills*).
6. What the same merchant's other rows say: a payee that paid credit out is a lender (*Lenders*), and the register's
   industry gives the rest.

### Card bills

A card bill moves money from a current account to a credit card. The purchases are spending already, on the card
account, so the bill must not count again. Each run works this out from the rows alone and stores nothing. A bill that
is no transfer (its card is not connected, or it pays purchases from before the card's rows begin) is *Luottokortin
lasku* in the debt flow (Velanhoito): it is in *Menot* and leaves the money once, but it is no purchase, so *Kulutus*,
the purchase categories and their shares of income do not take it. The purchases themselves come in only as rows: the
card's own, or a statement's.

- **The wording and the amount.** A payee named like a card issuer (Nordea Rahoitus, Bank Norwegian) is a loan payment.
  A card word in the text (*kortti*, *card*, a card brand or product) makes it a card bill at once. The name alone is
  no card: a lender that issues cards and lends otherwise is paid in changing sums for a card, a credit line, a
  flexible car credit or a loan alike. Such a payment is a card bill only when it names a connected card of the
  issuer. A bank among the issuers (Bank Norwegian) is then paid the card's bill at any sum. Of the other issuers'
  payments on one account, a sum that comes three times or more is an instalment and stays a loan, and the others are
  card bills when there are at least three of them and they change by more than a tenth from one payment to the next
  (the median change). With no connected card named, a monthly series of changing sums to such a lender is a credit of
  unknown kind (*Kulutusluotot*), and Tarkistettavat asks its kind. A saved card loan linked to the series makes its
  payments card bills; a credit line or a consumer credit keeps them as *Kulutusluotot*. A series of one fixed sum
  is an instalment and stays a loan, also beside the card's bills of a saved card loan, and is asked on its own. A card,
  credit line or consumer credit saved with no series and no account is taken as one such credit (the largest payment
  first), so it is not listed twice; Tarkistettavat still offers to link it. SEB Kort issues only cards, so its name
  alone is a card bill.
- **One reference is one contract.** A payment reference on three or more payments of one account and one payee names
  one contract, and its payments share the answer. When the sums that repeat three times or more are at least half of
  them (a tie counts), all are loan payments: an extra payment and a changed instalment are the same loan. Otherwise
  all are card bills, the equal ones too. A reference on one or two payments is an invoice's own number and says
  nothing: those payments are judged by their sums, with the ones that have no reference.
- **Pairs.** A payment out of one account and a payment into a connected card, with the same sum up to five days
  apart (`PAIR_WINDOW_DAYS`), are one transfer. Both rows are transfers, always.
- **The payment channel.** The payee of such a pair is the card's channel: the payee's account and the payment
  reference, or the payee's name and the reference when the bank gives no account. A payee with neither teaches
  nothing. One pair is enough when the payee is a card issuer, or is named like the card's bank and is not shaped like a
  person's name. Any other payee needs two pairs, because an equal sum within a few days can happen by chance. A payee
  whose payments are loan payments by the reference rule teaches no channel. A card paid with one fixed sum every month
  is therefore not learned: only the payments that pair are transfers, and the others keep the category the rules above
  gave them. The channel belongs to the card with the most pairs.
- **Before the card's first row and after.** A payment to a known channel that paired with nothing is a transfer when
  the card's own rows began more than a billing month (31 days, `paysPurchasesBeforeRows`) before it: the purchases it pays are on
  the card account. A payment within that time of the card's first row, or before it, is a card bill (*Luottokortin
  lasku*, debt service), since the purchases it pays are in no row. A channel that several cards share pays
  the card whose rows began last before the payment, so a new card's first bill is a card bill whatever the old card's
  rows hold. A bill that pairs is a transfer whenever it is paid, so the purchases of the first paired bill are counted
  nowhere.
- **The issuer fallback.** A payment still called a card bill, whose text names a connected card, is a transfer when
  the card's rows began more than a billing month before it, as with a channel; before that it stays a card bill. The
  text names a card when it holds the issuer's word and the card's product: a Platinum bill while only Gold is connected
  stays a card bill. A name is weak evidence, since a finance company shares its bank's name, so it counts only when
  nothing better is known: the card has no channel yet, the payment is not to the account and reference that paid
  credit out to the household (a lender's contract, which a flexible credit repaid in varying sums is: *Lenders*), the
  row is no return and was not set by hand. A bill that names a connected card is that card's also when its issuer paid
  credit out: only the payments to the account and reference the credit came from are left as they were.
- **Your rules.** The channel decides every payment that could be a transfer leg, also one that a rule of yours put in
  a debt, savings or *Muut* category. A rule to a purchase category (*Koti*) and a category set by hand on a row stay.
- **Data quality.** The card bills that are no transfer show in Tietojen laatu (*Korttilaskuja … ilman ostoja*) as a table by
  issuer: the bills of 12 months, and why the purchases are missing: no card of that issuer is connected, or the bank
  gives the card's purchases only from a day on. A bill dated before the card's first row, or up to 31 days after it
  (`paysPurchasesBeforeRows`, the rule of the transfer pairing above), is of that second kind. A later bill that pairs
  with none of the card's rows is *unmatched*. The sum is the same whichever way a bill is told.
- **Missing card purchases.** *Kortin ostot puuttuvat* has one owner, `missingCards` in `analysis/card-bills.ts`: the
  bills of `missingCardPurchases` over a range, for every reason, and their sum. Its one title is `missingCardsTitle`.
  The data quality signal reads it over its range. The first page's reliability line, the questions and the known share
  read it over the twelve complete months of `knownSpending`. `packages/core/test/missing-cards.test.ts` holds them to
  one sum and the catalogues to one title. Each card of it is a row of *Tarkistettavat > Täydennä lainat*: a card paid
  each month and not connected (`unconnectedCards`), else a card of `cardGaps`, whose statement brings the purchases in.
  `packages/core/test/unconnected-cards.test.ts` holds the two lists to the cards of `missingCards`. An issuer has one name under every legal suffix and word order (Morrow
  Bank ASA, Morrow Bank AB Filial and plain Morrow are Morrow Bank; Komplett Bank, SEB Kort, Bank Norwegian, Resurs Bank
  and Entercard likewise). The plain words *Komplett* and *Norwegian* alone stay what they are: a shop and an airline.
- **Statement rows.** A member may type in the purchases of one bill from a card statement. The bill stays one row on
  its account (its amount, the balance, pairing and returns never see the rows). The sums of spending by category and
  month, and the totals shown beside them (*Menot*, net and saved), read the rows on their purchase days and what the
  rows leave of the bill on its booking day, so the two add up to the bill to the cent. The rows are purchases
  (*Kulutus*) and what they leave of the bill stays debt service. The rows are read only when
  they add up to between 0 and the bill's whole amount, the period fits the bill, and the bank does not cover the
  period: the bank covers it when the booked rows of the card account the bill names SPAN the period, the first on or
  before its last day and the last on or after its first day. A card whose rows stop before the period (a lapsed
  consent) or begin after it leaves the statement's rows read. Rows that are not read are set aside, never deleted.
  A bill cut to a member's part of a joint account is cut once: the members' explained sums and rests add up to the
  bill's, to the cent.

### People

Money between the people of a household and their relatives is neither pay nor shopping, and a first name or a surname
is often a shop's brand too (Elisa, Helen, Silja), so a person is told before the shops.

- **Who the user is.** The bank gives each account its holders ("Matti Meikalainen, Elisa Meikalainen"). The user is
  the name on the most accounts, so a partner on one joint account and a child on one account of their own stand on
  fewer. Where two names stand on as many (a joint account alone, or two people's own accounts) the user is not known:
  nobody is told apart as a co-holder and the user's own name is not recognised.
- **Same person.** Two names are one person when every word of the shorter one is in the longer, and it has two words
  at least: "Meikalainen Matti Juhani" is "Matti Meikalainen". A payee with a company form is a company, also when it
  is named after a holder.
- **An own transfer, and money from a co-holder.** Money in from another holder of any of your accounts is money from a
  person (*Maksut henkilöiltä*, income that is not earned), whatever the text says, and also when the bank calls it an
  own transfer. Her *vuokra* is not your rent income and her *lainan lyhennys* is not borrowing. An own transfer in
  from you, or from a sender the row does not name, stays your saving. An own transfer out stays your saving, also to a
  co-holder's account. Where the co-holder's account is one that another member of the household connected, the
  money between the two is a transfer in both members' views: a member's categorisation reads the IBANs of the other
  members' accounts, and nothing else of them, to tell it. When a member connects or removes an account, the other
  members' rows are categorised again.
- **A person on a plain transfer.** A payee shaped like a name (no company form, no trade word) with MobilePay words or
  the bank's own words for a payment between people (*MOBIILIMAKSU*, *SIIRTO-MAKSU*), and no card in the row, is a
  person: *Maksut henkilöille* or *Maksut henkilöiltä*. Rent paid to a person is housing. Money in from a person named
  with none of those words stays income and counts as earned: pay and rent from a person carry no reference either.
- **A payment to a person with no reference.** Money out in a credit transfer (the row has the payee's account) with no
  payment reference and no card, to a payee shaped like a name, is *Maksut henkilöille* without those words too. With a
  reference the payee may be a sole trader, so the row keeps the reading of the rules that follow when its message
  holds a reference, an invoice word or the word of a purchase or a service. The same goes for a steady payee (the
  account pays about the same sum in three or more months, `steadyParties` in `returns.ts`) and for the user's own
  name. Where the user is not known the own name cannot be told, so such a row is a payment between people.
- **MobilePay at a till.** "MOB.PAY*" in front of a payee, with a person's name behind it, is a person, unless the
  card's merchant code names a shop.
- **A card row.** On a card account the country and the town in front of the payee are dropped before a person is
  looked for. A row with a card's code or a card terminal's text is never a payment to a person by the bank's word or
  by the holder's name: a card pays a shop, whatever the shop is called.
- **What stays a shop.** A card row, and a payee with a company form or a trade word in its name. A trade word in front
  of a name (*Kampaamo Liisa*, *Siivous Virtanen*), a town (*Helsingin kaupunki*), a company with its form between two
  words (*Bostads Ab Exempel*), a school or an association (*Esimerkin koulu*) is no person: the rules after the people
  sort it. Money in with a pay word or the bank's pay code is pay, unless it comes from a co-holder or through
  MobilePay.
- **A payee that may be a person is not asked about.** The trade register is public, so a payee goes there only when it
  may be no person (`mayBePerson` in `payee-guard.ts`). It may be one when its name has the shape of a person's, when
  it holds a word of a name the household has (the holders of its accounts as the bank gives them, its members' display
  names), or when nothing but an invoice speaks for a business and the name does not say it is one (a company form, or
  a business word with no person's two names beside it). An invoice to one bare word (*Zorro*), to a name with a sign
  in a word (*A&B Esimerkki*) or to an e-mail address is therefore no business's alone: it counts when another row of
  the same merchant shows a business in another way (a card payment, a merchant code, a company form or a business
  word). What is sent and what the guard does not catch is in
  [SECURITY.md](SECURITY.md#trade-register-lookup).

### Lenders

A household's debt payments and the credit it draws are told as debt and as borrowing (ADR 0014). A lender is found in
four ways, in this order, and the first that applies decides.

1. **The lists.** Banks that lend mortgages, finance companies, consumer lenders, peer lending, and the words of
   lending in the text (*laina*, *luotto*, *lyhennys*, *osamaksu*).
2. **The shape of the name.** A limited company (Oy, Oyj, Ab, Ltd and the like) with a word of lending in its name is
   a lender when the row is no card payment. The words are finance, credit and loan, which may end a compound
   (*rahoitus*, *finans*, *kredit*), and bank, as a word of its own or after *säästö*, *osuus*, *hypo*, *asunto*,
   *spare* or *handels* (Osuuspankki, Sparebank, not Powerbank). Money out to one is debt, and *financial* counts as a
   word of lending then. Money in is credit drawn by finance, credit or loan only: a bank also pays pay and bonuses and
   returns deposits, and the pay words and the bank's pay code are read before the name. A word of credit inside a
   company's name (a compound ending in *luotto*, *autorahoitus*) is read only when the row is no card payment: a card
   purchase from such a company is a purchase. Not a lender by its shape: a card payment, an insurer, a housing company, a lease, a bond, a text that names a card, a refund coming in (a
   lender's overpayment sent back is one), and a name with a trade word in it (a restaurant called The Bank).
3. **The payee's own payout.** A payee that paid credit out to the household is a lender, so its later payments are
   debt, also when the text says nothing of lending. A person and the user's own name are none, since the money they
   moved is not credit. The payee is the merchant name, so another form of the lender's name is missed. A card payment
   to such a payee stays a purchase.
4. **The trade register.** A credit institution (TOL 64.19) or another grantor of credit (64.92) gives debt, again
   except on a card.

**The household's own bank.** The bank of a connected account is no lender by its plain name. Money out to it (a paper
statement, a share subscription, a card's bill paid by reference) is not a loan payment by the name alone, and the
register's answer "credit institution" does not make it one: the name rule and the register share one test
(`isOwnBankPayment`), so a row has one answer. Another bank of the same kind (a savings bank, a cooperative bank) is
not the household's own: the kind of bank in a name names nobody when the name has another word. A loan at the bank
that is paid like an invoice has no word of a loan to read, so its reference tells it: money out to the bank itself,
with a payment reference and no word in its text, is one contract for each reference, and when the sums that repeat three
times or more under it are at least half of its payments, they are a loan's instalments (`isInstalments` in
`card-channel.ts`). A fee or a subscription is not paid so. A company that only shares a word with the bank's name
(its fund company) is no contract, and a card paid one fixed sum under its reference reads the same as a loan, which
only a pair with the card's own row tells apart. This holds for money out only, and never for the bank's finance company,
a name that holds the bank's word and also a word of finance, credit or loan with a company form. That is a lender like
any other, both ways. Money in from the bank stays what it is: pay, a bonus, a deposit coming home.

A row of the bank itself, with no payee, is told by its text. One street address and nothing else is the row of a cash
machine (*Käteisnostot*) when the row has no merchant code or the code of cash. The word of interest makes interest
also inside a word (*velkakorko*) and as *koron* or *korot*. *Lähdevero* is tax, and *päivittäispalvelu* a fee.

### Merchant names

The merchant name groups rows: rules, marks, the trade register's answers and every merchant figure are kept by it.
`cleanDescription` and `normalizeMerchant` in `merchant.ts` work it out in this order:

1. The bank's payee field is read first. The text is read when the payee is empty or cleans to nothing.
2. The lead of a card account's text ("Osto FIN Kuopio ...": the word *Osto*, a country code and a city) goes. The city
   goes only when the text proves it is one: the same word ends the text, a payment service follows it, or it is a town
   on the list. Otherwise only the country goes. A surname that is a town (Salo, Lahti) stays with a person's name.
3. A payment service's prefix goes, once or twice: PayPal, SumUp, Zettle, PTL, Klarna and the like, before a star or, for
   a service of four letters or more, as the first words of a bank transfer with its company form. Without a star the
   service's name stays only when a place, and a country at most, is all that follows it ("Paytrail Oyj Helsinki").
   "Paytrail Oyj Turku Energia Oy" is *Turku Energia Oy*.
4. Noise (*Osto*, card masks, dates, times, long reference numbers, signs) and the towns and country codes at the end,
   up to three, go. A brand list then gives the brand's own name whatever follows (Spotify, Tori, Eneba).
5. Otherwise the name is the first four words, at most 40 characters, with capitals as in a name.

A name that is not a shop's, a person's name or the name of a way to pay, is never sent to the trade register.

The names are worked out again at the first start after an update that changes the cleaning, for every member
(`followingNames` in `services/upgrade.ts`). A rule, a mark, a loan's series and an answer *Ei ole velan maksu*
follow an old name when every row of it gets one new name that no other old name gets. When old names merge,
a rule on one of them would reach the rows of the others, so it is not renamed. Its category is written on the rows of
its old name as the household's own choice and the rule is deleted. Rows set by hand and rows stored as transfers are
left alone. An income category reaches money in only, a debt category money out only, and any other category both. A
mark or a decision on a merged name stays on the old name, where no row finds it. A second start renames nothing.

### Income

Pay is found as a series of payments from a regular payer (`income-series.ts`, `income-changes.ts`).

- **A regular payer's only payment.** A payer with a salary series of three pay periods or more may pay a sum that
  differs from the usual, and the sum may be typed as holiday pay or other pay. When it is the payer's only payment in
  its pay period, it is regular pay up to the payer's usual level, the median of its last six pay periods read before
  the payment, and only the part above is extra pay. A payment at or below the usual level is typed *Palkka* and joins
  the series. A second payment in the same period is not read this way.
- **A change of payer.** *Mikä muuttui* on the income report lists a change of payer or a stopped pay that falls in the
  twelve months the report shows. The alert on the first page reads the same list but keeps a change only
  `FIRST_PAGE_DAYS` (120 days) after the old payer's last payment. The new payer is one that began after the old one,
  within `SWITCH_PERIODS` pay periods of the old one's last and not long before its last payment. On the same account
  it needs two pay periods or a level within `SWITCH_LEVEL` of the old one's. On another account (another member's
  pay) only that level counts. Of the payers that fit, the one whose level is nearest the old one's is the successor,
  the same account first, and a payer follows one old payer only. A stop and a start that close are one change
  (*Palkanmaksaja vaihtui*).

## Money that comes back

Money that returns a payment is not income. A refund from a known shop gets the shop's category when the row is
categorised, and the reports decide whether it lowers spending (*In the reports* below). For the rest, the app looks
for the payment that a returning row cancels. The
returning row takes that payment's category and shows a *palautus* badge in the transaction list. It is
decided from the rows alone on every reprocess, so changing the payment's category by hand moves the
refund with it. A category you set on the returning row stays.

Only rows that nothing else recognised can be returns: unrecognised money in, a text with a refund word
(*hyvitys*, *palautus*), and MobilePay from a person. Salary, benefits, insurance claims and rows with
a category you chose are never matched.

| Case | Matched when | Result |
|---|---|---|
| A shop pays back | same merchant on the same account, the purchase is up to 120 days earlier and at least as large, in full or in part | the purchase's category goes down by the refund |
| A contract ends with a refund | the payee is a company paid by an equal or varying monthly series of three payments or more (a lease, a loan, a phone, a gym), the refund comes up to 60 days after the series' last payment on the same account, the contract has ended (no payment by the expected day plus one and a half cadences, and 20 days past it) and no payment of the same run followed the refund, and it is no more than the contract cost altogether | the category of the contract's payments goes down by the refund, the latest payment first, whatever the 120 days (`closedContract` in `contract.ts`) |
| A person pays back | same person on the same account, exactly the amount you sent them, up to 90 days later | *Maksut henkilöille* goes down |
| Friends send their shares | the bill was paid to a business, and within 10 days one person sends the whole amount, or at least two different people send the same share and the bill divides into 2 to 8 such shares (cent rounding allowed) | the bill's category goes down by the shares |
| MobilePay money in that names no sender | the household bought something (not a bill, cash or a person) 0 to 7 days before, and two rows at least together come to the purchase less one share (within 1 € for each payer). A row that comes later joins the purchase when it is about the purchase divided by 2 to 10 and the shares stay under the purchase. A lone row matches nothing: one sum that fits a purchase is a coincidence. The nearest purchase in time first, then the larger. Each row is decided from itself and the rows before it, so a later row moves no earlier match | the purchase's category goes down. What no purchase explains stays income and is asked once, as one group (`mobilepay.ts`). Answered as shares of shared purchases, a row is no income: it nets against the nearest such purchase in the 14 days before it, else against *Muut menot* |

A wrong match hides real income and a missed one only leaves a refund in the income, so each rule asks for
more than a shop name or an amount:

- A payment is cancelled once, and never by more than it cost. A returning row cancels one payment.
- Both rows are on the same account. Moves between own accounts are transfers and are left to transfer
  detection. A refund on a connected card is not read as a card payment.
- A person who sends part of what you paid, a share of a bill alone from one person, shares of different
  sizes, the same person twice and shares after 10 days stay income. Change them by hand.
- A sender who pays about the same amount (within 10 % of their median) in three or more different months is
  regular income: rent from a lodger, an allowance. It is never matched, so a loan that is repaid in equal
  monthly instalments stays income too.
- A refund after 120 days and one larger than the purchase stay income (a contract's closing refund, above, is the
  exception), and one to another account is not paired here. A shop gets 120 days because that is how long a card dispute runs, and a cancelled trip or a complaint can
  take as long. A person gets 90, since only an exact amount from the same person is evidence.
- **In the reports** money in on a spending category lowers spending only as a refund (`moneyIn` in
  `analysis/money-in.ts`, applied once in `createContext`, so every sum follows it). The pair of a person who paid
  back and the friends' shares of a bill stay as they were paired above. A shop's refund is decided from the rows of
  the view: the same payee was paid in the 120 days before (`REFUND_WINDOW_DAYS`, the window of the table above), from
  any account of the view and in any category, and the row is not larger than what is left of those payments. It
  lowers the category of those payments, in the month it arrives. A row whose category you set by hand lowers that
  category, whatever the payee and the days. Any other money in on a spending category is income: *Hyvitykset*, or
  *Maksut henkilöiltä* from a person. A purchase that was paid back leaves the lists of merchants, habits and double
  charges by the amount that came back.
- Money from a person that nothing placed (*Maksut henkilöiltä*, a rule's row and no answer) settles what you sent the
  same person in the same month (`netPersons` in `analysis/person-netting.ts`, after the refunds and the split guess).
  The row takes what is left of those payments and lowers *Maksut henkilöille* by that much, so the income and the
  spending fall by the same cents and Tulos is what it was. Only the rest stays income that is not earned, so a month
  that took in more from a person than it sent them shows the surplus as *Maksut henkilöiltä*. Payments to other
  people stay as they were. A row you categorised, a row whose payer you answered for, money from a steady payer and a
  friend's share of a bill that the split question asks about never net, nor does money whose sender is
  only the name of a way to pay (unnamed wallet money, "MobilePay", "Siirto"): it is not one person. The payer question
  reads a netted row as it came in, with the full amount received, so your answer for that payer is still asked for and
  still overrides the netting.

## Alerts

The overview shows up to six alerts for the selected period. They are about money
that may be going to waste. Clicking one opens the transactions behind it.

| Alert | When it shows |
|---|---|
| *Sama veloitus kahdesti* | The same merchant, amount and day twice on one account, at least 20 €. A merchant that does this often (two cinema tickets) is left out. A monthly bill paid twice within a week counts too |
| *Myöhästymiskuluja* | A payment text with *muistutusmaksu*, *viivästyskorko*, *perintäkulu* or *karhumaksu*. Shows the total and the merchants |
| *Kaksi äänikirjapalvelua* and the like | Two or more active subscriptions of the same kind: audiobooks, music, cloud storage, video. Video is shown as information only, the others as a warning |
| Category spike | A category that rose in the month against its expected figure in the *Menojen muutos* report, by the report's gate or more and out of its own noise, with the report's amount and expected figure (ADR 0013, ADR 0021). Every category is read, also one the report's table folds into *Muut*. The month is the report's: the one the period ends in, so the running month's spike shows when Yhteenveto shows the running month, and last month's when it shows the month before. The rise in purchases that are no one-off and no bill or subscription of a month or longer must be at least 50 €, over half the usual level, from three or more purchases, most of the category's rise and above every usual month, so a sofa, a car repair, a new subscription or a bigger bill is not a spike. A running month is set against the same days of the base months (*Odotettu tähän mennessä*). When the rows end before today, the alert names the day both figures are cut at (*10.10. mennessä*). A month that was as far above usual a year ago does not count. Before a year of history, December gifts and shopping and summer trips and outings do not count either. Uncategorised rows and loan payments never alert |
| A forgotten subscription, titled with the merchant and its cost (*Esimerkkipalvelu 12 €/kk, 144 € vuodessa*) | An active subscription that the recurring detection marks for review: a service of 3–15 € a month (a gym up to 60 €) that has run for half a year. The alert says how many months it was paid and asks with the buttons *Käytössä* and *Lopetettu*. Shown when the period reaches today, two at most |
| *Pankkikuluja … vuodessa* | Bank fees and interest add up to over 100 € a year, judged over at least six months and 150 days of data. Reminder fees and late interest have their own alert |
| *… kertaa kuussa* | A merchant with at least eight small purchases a month (median under 10 €) over the last 90 days, with the yearly sum. Fixed costs, cash and payments to people are left out |

Alerts only read the data, so fixing a category or a transfer can remove one.

## Periods and fixed costs

- Yhteenveto offers two months and names them (*Lokakuu 2026*, *Syyskuu 2026*): the running month, which runs to
  today and is compared with the same days of the previous month, and the month before it, whole. *3 kk*, *6 kk* and
  *12 kk* on Raportit are the last whole months. *Tämä vuosi* on Raportit runs to today. Its savings rate counts its
  complete months, because the running month has its bills but often not yet its salary. The same-day comparison
  of the running month reads one matched basis (`matchPrevious` in `analysis/matched-fixed.ts`), the "last month, same
  day" lines of Menot (`pace.previous.toToday`) and of Tulos (`previousTotals`, the categories' `previousCents`) alike.
  Each monthly fixed series counts as many payments in the previous month as this month has booked: when the previous
  month has more by this day, its latest ones are left out; when it has fewer, the earliest it books later in that
  month are added. A payment from another account or under another payee name that settled an occurrence is the
  series' payment. A rent the previous month booked on the 16th is not set against a month that has not booked it yet,
  and an insurance this month booked on the 15th is set against last month's on the 18th. The month's own totals and
  the whole month before always hold every row. A period that is over, and a running range that is no month to date, is
  compared as it is, and so is a running month whose month before is shorter than today's day of the month (31.10.
  against September), which is read whole. Menot leaves a payment of the month before out only when it was booked on
  one of the days Menot reads. On the last day of a month Tulot, Menot and Tulos all read the whole month before (30.4.
  reads all of March, 28.2. all of January), so a row of 31.3. is in each of them, or in none. A fixed cost that moves to a new payee shows as a difference until the new payee has three
  payments and is a series.
- *Menojen muutos* (on Yhteenveto, with the month before the running one chosen) sets the month against its
  expected total and splits the change into causes by category. A category's base is its expected figure (*Odotettu*),
  and the month's is their sum, so the rows add up to the headline and *Muut* holds nothing of its own. Inside a
  category the merchants keep the mean of their own months, and what that leaves of the category's figure is *Kuukausien
  vaihtelu*, which is no cause.
- The block *Erääntyvät maksut* on Yhteenveto counts to the next payday (*The days to the payday* below). The list of
  the same name on Laskut keeps its 30 days: it lists the subscriptions and bills of the next 30 days from the same
  series as the block, whatever the block's window is and whichever account pays them. Its groups are what the accounts
  pay to the payday, what they pay after it, and last what a credit card is charged (*Kortilta veloitettavat*,
  `onCard`), so the first group's sum is the block's figure *Erääntyvät maksut*. It has no pay,
  no card bill and no transfer. A bill of a series is no row once it is paid: by the series' own row, or by a row the
  rule for a bill paid another way takes (`recurring-settled.ts`, *Bills paid another way*), except while that row is
  pending on a counted account: then the bill is listed, marked *varaus*, as in the block. What an account outside
  the balance pays before the payday is in no figure of the window; `ahead.outside` finds it to the payday also when
  that is more than 30 days off. Yhteenveto names its sum in a line under the answer's sum row, and Laskut lists it
  before the payday.
- The bill calendar (`billCalendar` in `reports/bill-calendar.ts`) lists the twelve calendar months from the one of
  today, a row for each bill, loan payment, regular saving and pay, with the sums of each month. A row is *known* when
  the sum is fixed: a bill typed in, a series of one price, a loan payment of the loan's own plan, a card's next bill
  when the card's balance is known, a pay the two next paydays find. It is an *estimate* when the sum varies: a monthly
  series with a charge in the same month of last year takes the largest of them, any other its typical sum, and a regular
  pay beyond the two next paydays comes at its typical sum on the days of its cadence and pay day. A loan payment whose
  interval starts on or after the loan's next review day is an estimate too: the loan's schedule counts it at the newest
  published fixing and the margin, and with a fixing and margin that leave the rate as it is, the payment stays as it
  was. A loan with no margin or review day keeps its typed payment. A charge made this
  month is *paid* and no part of what is still to come; the month's `paidCents` adds those bills and loan payments up (a
  card's left out), so the running month's rows end in two totals, *Maksettu* and *Tulossa* (`billsCents`), instead of a *Laskut* that
  would read 0 over paid bills (the chart's column of a month is those two stacked: `paidCents` filled, `billsCents` hatched, each split into the regular and the rare bills, and `wholeBillsCents` is the two together; a saving is no part of the column), and a month with nothing left to come has no *Laskujen jälkeen*; a loan a series paid this month has that charge as its row of the
  month and no payment of its plan besides. A loan with one payment at its last day has a row on that day for what is
  owed. A bill typed in under the name of a rare bill the history found counts once, as the found one. A loan a series
  pays is the series' row. A pay that is late, money from people and a settlement between members are no income row. A
  series of card bills is no row: a card's bills are its spending, and only the next bill of a connected card is listed.
  A bill or loan whose sum or date is not known has no row, and `unknownCount` counts it: no row reads 0. `unknowns` keeps
  the days each one falls on. A month's `afterCents` is null only in a month such a bill, saving or pay falls in (a
  loan's payments after the first with no sum, and the pays beyond those found, count from that month on) and in every
  month while one has no day; a bill far ahead leaves the near months their figure. A bill that a card or an account
  outside the balance pays holds no month.
  A series that a card or an account outside the balance pays is a row marked `onCard` and is in no sum of the month: the
  card's bill holds it. A regular saving is a row of kind *saving*, in the month's saving (`savingCents` while it is to come, `savingPaidCents` once charged) and in no bill sum. Every row a month lists is in exactly one figure: a paid bill or loan payment in `paidCents`, one still to come in `billsCents`, a saving in `savingCents` or `savingPaidCents`, a pay in `incomeCents`, and a row a card pays in none, its status says so; so the pays less *Tulossa* and *Säästöön* are *Laskujen jälkeen*. An open month's rows end in a total each for *Maksettu*, *Tulossa* and *Säästöön* (once a saving is charged, one under *Nyt* and one under *Arvio* for the part still to come). The rows
  of the days to the payday that bills and loans and saving make, with the card bills sized by balance, add up to the
  bills of Nyt's window (*Erääntyvät maksut* and *Siirrot omille tileille*) less the own transfers, the bills of cards
  sized by their usual payment, the bills of a series of card bills and the bills that follow today's pay.

## The first page

Yhteenveto opens with the card *Varat ja velat*. Then come the blocks *Luokittelemattomat*, *Erääntyvät maksut* to the payday,
*Asuminen*, *Tulot ja menot* and last *Ilmoitukset*. The figures of *Varat ja velat* and of the running month's spending are core's.
The page shows them as given.

**Luokittelemattomat** is `buildQuestions` (`analysis/questions.ts`): it tells how much of the spending is known over the twelve complete months up to the period's end (`knownSpending` in
`data-quality.ts`), and the questions of the last 365 days that would mend it most. Known is spending that is not left in
Muut menot by the default (by what the purchase cost in the end), leaving out card bills (purchases the app cannot see);
income is not part of the share, a transfer is no money, and a refund lowers the spending it took back. The share is
`1 - Muut menot / spending` and the page rounds it down to a whole percent. The block is drawn when something is
asked or under 95 % is classified. A question has one of five kinds:

- `payee_out`: a payee whose spending is in Muut menot by the default (a payment service such as Trustly is asked per
  service). A category for it moves every row of the payee out of the unknown; *Ohita* keeps its money among the unknown and ends the question.
- `payee_in`: a payee whose money the default left in Muut tulot; a category, or *Ohita*, as above.
- `loan`: a monthly payment that looks like a loan the app cannot place. A kind saves it as a loan (Raportit > Varat ja velat > Lainat). *Ei ole velan maksu* ends the question.
- `plan`: an instalment plan of a payment service whose end the household has not said; it is answered with the payments left, the last month or *En tiedä*.
- `payer`: only when the inputs carry payer roles. A payer that is steady (about the same sum in three months or more) or
  reaches `ASK_LIMIT`, with no role yet; it takes the place of the payee questions about the same money. A role
  (`PAYER_ROLES`; MobilePay money with no sender is asked only as cost share, sale or gift) rewrites every row of the payer, the past ones too.

The questions come largest sum first (the window's sum; a loan's is twelve payments, or with no monthly figure what it owes at least or its latest payment, `proposalWeight`), ties by kind and name. The block lists five, or three when the inputs
carry payer roles; `total` counts them all. A card bill is told in a line of its own (the issuers of the largest two), not as a question.

**Varat ja velat** is `buildHoldings` in `holdings.ts`, the answer Saldot reads too. A group with nothing in it is left out. In a member's own view a joint account, a card
or a loan that other members use is counted at the member's part, and its row says so (*osuutesi 60 %*, see *Joint
accounts*).

- **Tilit.** Checking, savings and other accounts, each with its balance from the day walk and every account its own row,
  in the order core gives. The last row is *Tilit yhteensä*, `accountsCents`: the known balances of the accounts added
  together. An account the bank gave no balance shows a dash and is left out of the sum, which says so in the small line
  under it (*Ilman 2 tilin saldoa*); with no known balance at all the total is a dash, never 0.
  The totals count in euros: an account in another currency shows its balance with its currency code (*540,00 USD*)
  beside them, is in no total and is not counted as missing a balance; one whose currency is not known shows a dash. A
  balance is stored only in the account's own currency. The day walk starts from the day the bank says the balance
  stands for (its reference day), and from the day of the fetch when the bank sends none. A row the bank books in another currency is kept apart in its own figure (`foreign_rows`), listed under its
  account in Asetukset > Tilit and in no euro sum; the bank's euro balance may hold its euro value, so the walk of that account
  is unknown for every day before the newest such row, and a day total with such an account is a dash.
- **Luottokortit.** Each connected credit card has its face at the left of its name and its rows: a card the app draws
  itself, in the tone the card's name gives (gold, platinum, black, silver or plain), with the bank's logo or name, the
  last four digits of the number and the tone's word. *Käytetty luotto* is what is
  owed on it as `householdDebts` counts it (`usedCents`: 0 for a card in credit, a dash when the bank gave no balance) and
  is shown in the colour of what is wrong when the card is over its limit. *Luottoraja* is the limit the bank gave, when it
  is above zero, and *Luottoa jäljellä* is the limit less what is used, 0 over the limit (`freeCents`). A card over its limit
  shows *Luottoraja ylitetty* and what is owed above it (`overCents`) in place of *Luottoa jäljellä*. A card with no limit shows
  what is used alone. The last four digits of the number follow a card's name only when another card has the same name; the face shows them
  for every card that has a number.
  With two cards or more the last row is *Luottokortit yhteensä*, `cardsCents`: the cards' known use added together.
- **Lainat.** Every debt of `householdDebts` that is no connected card's: a saved loan, a loan account, and a saved loan
  linked to its account once. *Lainaa jäljellä* is what is left on the day (`leftCents`), and a loan whose balance is not
  known shows a dash and is left out of the debt total. *Kuukausierä* is the next payment spread over a month, and only a
  loan that has one shows it. The last row is *Lainat yhteensä*, `loansCents`: the loans' known balances added together.
  Debts with no balance stand under the totals as rows of their own (`unsavedLoans.rows`): a lender paid every month whose
  loan nobody saved, a lender paid only a few times, and a card whose bills are paid and whose account is not connected
  (`unconnectedCards`). Each shows its monthly payment, when it has one (a lender's few payments have none), and *saldo puuttuu*. Their balance is never added and never read as 0, so while
  such a row is there the loans' total is named *Lainat yhteensä, tiedossa* and the debt total *Velat yhteensä, tiedossa*,
  and the first page's accounts less the debts says how many debts it leaves out. A card saved as a loan, marked *Ei ole velan maksu*, or
  from the issuer of a connected card account joins no row, and a card loan saved with no link takes one series.
- **The sums of the groups and of the debts.** A group's sum comes from core (`accountsCents`, `cardsCents`, `loansCents`:
  each null when no figure is known, never 0), and the page adds nothing up. When a card has something used and there are
  loans, a row under all three groups gives `debtCents`: *Velat yhteensä*, the one debt total of `householdDebts`, in which
  the cards' use and the loans' balance add up to the cent.

**Menot** is `monthPace` in `analysis/forecast.ts`. Spending is what the totals count, consumption and debt service
(`flowSpendSelect`), a debt paid from a savings account not among it, and the usual it is set against is read from the
same rows (`expectedFlowsFor`). Nothing is forecast: both months are sums of real rows. The card shows the running month only; the month before is told
by *Menojen muutos*.

- **The figure** is the month's spending so far, `currentTotal` of `monthPace`: the cumulative spending to today, 0
  before the 1st.
- **The line under it** (*Syyskuussa 12.9. mennessä* and a sum) is the month before by the same day of the month
  (`previous.toToday`), or by its last day when that month is shorter than today's day of the month. It is left out
  when the month before does not compare day by day (`comparesWith` in `analysis/forecast.ts`): the history has no row
  in it, an account that spent in either month has no data for the whole of both, or either month paid a card bill
  that is no transfer (it holds a month of a card's purchases on one day, on a different day each month).
- **The chart** (*Menojen kertymä*) draws both months day by day, each the cumulative sum of its rows: the running month
  to today, the month before to its last day. The month before has no line in the same cases, and with nothing spent
  yet the card says so in a line instead of a chart.

## The days to the payday

The block *Erääntyvät maksut* on Yhteenveto answers one question: does the account cover what is due before the pay
comes. `cashAhead` in `analysis/ahead.ts` owns its figures, and the block (`components/next-days.ts`) only words them. Laskut lists `upcoming`, the next 30 days, in the groups of `upcomingGroups`: to the window's last day, after the pay, and
what a credit card is charged, each with its sum, sent by `GET /api/ahead`.

- **The payday** is the nearest coming pay among the regular incomes whose usual amount is at least half the largest
  one (`MAJOR_PAY_SHARE`); of two on one day, the larger. A pay is late by the largest income alone. A monthly salary
  comes on its pay
  day as the income code finds it from the dates it was paid on (`payDayOf` and `nextPayDate` in `analysis/income.ts`,
  the rule the income report prints the next pay by): the usual day of the month, moved to the banking day before when
  it falls on a weekend or a bank holiday, or to the one after for a payer such as Kela. Other cadences, and a payer
  with no fixed day, follow the series' own dates. The window runs from today to the day before the payday.
- **Three states** (`reason`). *payday*: the window ends the day before the payday. The block is titled *Erääntyvät
  maksut*, and the line under the title names the payday: *Palkkapäivään asti, pe 23.10.* When the payday is today or
  tomorrow the window is today alone. On the payday itself, until the pay is booked, a bill that follows that pay
  (`RecurringSeries.follows`) is paid from it and is no row of the window; any other payment of the day is a row. A
  pay that is late, or behind its day and not late yet, ends no window: the window ends the day before the nearest pay
  to wait for whose day is still to come, and is 30 days without one. A pay behind its day is told in the line, after
  the window's real end (`Payday.next`), with the day it was expected (`Payday.expected`): *Palkkapäivään asti,
  to 22.10. Palkka ei ole vielä tullut, sen piti tulla ma 5.10.* *none*: there is no regular income, or its next pay
  is more than 45 days away (`MAX_PAYDAY_DAYS`), so the window is the next 30 days (*Seuraavat 30 päivää*). *late*:
  the largest regular income is more than five days late (`OVERDUE_DAYS`); the line says since when the pay was
  expected, and the days it counts are those to the next other salary, or 30 without one.
- **Which accounts it counts** (`poolOf` in `analysis/pool.ts`, the pool that Tulos counts too; `counts` on the balance, said under *Saldo*). *all*:
  every checking account in view, each whole, which is Koko talous and an own view with no split account. *part*: the
  member's checking accounts and a joint account at the member's part. The line under *Saldo* says which when it is not *all*. A card's
  debt is taken off only when no payer of its bills is seen outside the pool. The
  payday is that of the whole view, whatever account the pay lands on. Everything else follows the counted accounts: a
  charge is a row when one of them pays it, other pay when one of them gets it, and the usual everyday spending is what
  they paid themselves. A bill the household typed in names no account and always counts.
- **What the window holds.** What the counted accounts pay and get: the subscriptions and bills that the history shows
  (also savings plans, which leave the checking account), the bills the household typed in while they are still to
  pay (one that the history shows as a series is left out, and so is one for which a row of about the same amount,
  within 5 %, was booked from 31 days before its date up to today: `expectedBillRows` in `analysis/forecast.ts`), other
  pay that lands inside it, the bill of a connected card and a regular transfer to an account the window does not
  count. The payday itself is no row. A bill that a payment from another account settled is no row once the bank has
  booked that payment. While the payment is pending on a counted account, the balance read from the bank does not hold
  it yet and the bill's money is still in it, so the bill stays a row, marked `pending` (the page says *varaus* after
  the payee), and stays in `dueCents`: the list and the sum always agree. A pending payment on an account the balance
  does not count, a credit card among them, leaves no row. With a checking balance it gives three figures: the balance today
  (`startCents`, as Saldot has it: the bank's balance with the rows booked since), the payments due in the window
  (`totals.dueCents`: bills, typed bills and card bills) and the balance less them, the own transfers and what the connected cards owe that no card bill of the window holds (`freeCents`, `cardDebtCents`). A card's whole debt today (`creditUse`, the `usedCents` of Varat ja velat) is taken off, so the day its bill falls is never guessed: a card paid as it goes, one whose bill falls after the window and the part of the debt a bill of the window does not hold count the same, and a bill the window holds is not taken off twice. That holds for a card bill and for a typed bill whose payee account number is the one account number of a connected card (the row then carries that card's `cardId`); a typed bill with no number, or one that no single card has, proves nothing and stays a payment beside the debt. A predicted bill of that card is a guess at the same payment: the typed bills of the card cut it, in the order of the days, and a predicted bill they cover is dropped, so the rows that pay one card and the debt taken off besides them come to the larger of the debt and the typed bills. One place settles all of it (`reconcileCardPayments` in `analysis/card-payments.ts`): a payment already booked on a counted account is in that balance. One with a leg on the card is in the card's balance too. One with no leg on the card (a leg pending or not synced, a payment that names the card's own account number, one to the payee the card's paid bills went to, when exactly one card has that payee) is sorted by the day the card's balance stands for (`balance_at`): booked after it, the balance cannot hold it and it is taken off the debt first; booked on that day or before, or with no such day, the balance may hold it, so the debt stays whole and the explanation of the figure names the payment as one that has not yet shown on the card. A payee two cards share ties the payment to neither. An own transfer between counted accounts and a payment that no proof ties to a card change nothing; then the typed bills and the predicted bill, as above. A statement only decides whether a bill is predicted at all. A card with no balance leaves `balance` null (`missing: "card"`, the tile says *Kortin saldo puuttuu*) instead of reading as owing nothing, and Tarkistettavat asks for that card's balance (`card_balance`). A card whose balance is in another currency has no euro figure either: the same item names the currency and says the figure counts in euros only, so it is never left out unsaid. An own transfer is no payment. It is `totals.transferCents`, shown as *Siirrot omille tileille* when there is one, and `totals.leavingCents` is both added up. No
  day's balance is modelled and pay in the window is in none of those three. The figures need the balance of every counted
  account. `shortOn` is the day of the first payment that the balance and the pay dated before that day (as much as it
  is at least: `floorCents` of its estimate, 0 without one) do not cover, and `shortCents` the most the account lacks at
  a payment. The expected everyday spending of a day (`everydayPerDayCents`) is the expected figure's everyday part
  (`expectedEverydayPerDay`, ADR 0021): the mean of the complete months before the running month (up to six, at least
  three) outside subscriptions, bills, card bills and one-off purchases, over the month's days. It counts every account
  in view, so the purchases on a card that is paid by a monthly bill are in it, and it is 0 under three complete months
  or when a linked card's purchases are missing from them. It is in the answer, on no page and taken off none of the
  window's figures.
- **Jää palkkapäivänä** (`runwayOf` in `analysis/runway.ts`, the `runway` of the dashboard answer) is what the counted
  accounts hold on the day before the next payday: today's balance, less the payments and own transfers of the window
  (*Käytettävissä*, the card's bill among them), less the everyday spending expected on the days from today to the day
  before the payday (`expectedEveryday`) that the counted accounts pay themselves (their own rows and the cards they
  pay as it goes). Its range runs from the lower to the upper quartile of the base months' everyday spending. A card's
  purchases leave the account once, with the bill that pays them. A purchase already made is in the bill of the window.
  A card paid in full has a bill that holds what it owes today and the purchases after today up to the bill's day, so
  when that bill falls before the payday those expected purchases are taken off too (`billedCents`). A purchase after
  that day waits for a bill after the payday, so it is told (`laterCents`) and taken off nothing. The payday is the pay the window waits for. If it is unknown, or a counted account has no balance, or there are
  under three complete months, the answer is `known: false` with the reason and no figure.
- **A coming pay is an estimate, never a bare sum** (`payEstimate` in `analysis/pay-estimate.ts`). It rests on the
  series' regular pays only (holiday pay and other pay are left out), the newest twelve after the newest step in the
  level (`levelStep`: a new tax card or a raise makes older pays no evidence), and on three at least; with fewer the row
  has its day and no sum. A pay whose largest and smallest differ by at most 2 % of the median is *steady*: the page says
  *noin* and the median. Any other is *varies*: the page says the range of the estimate, the 25th percentile
  rounded down to whole euros (`floorCents`) to the 75th rounded up (`ceilCents`), and under the table one sentence of the pays that
  came (*Palkka vaihtelee: ... tavallisin ...*, with *Vähintään on tullut* the smallest level when six pays exist and the
  smallest three are within 2 %). A calendar month that two earlier years paid over 10 % above (or below) the year's
  median moves the estimate by the smaller of the two ratios (`season`). The only sum of a pay that any figure adds is
  `floorCents`.
- **A card's bill** is a row on the median day of the month of its last three bills (`expectedMoves` in
  `analysis/ahead-moves.ts`). Its sum is what the card owes today when the last bill was paid in full, that is when it
  is not late and covered what the card owed after the bill before it; the row is the card's name with the line
  *Luottokortin lasku*.
  Otherwise it is the usual bill, the median of the last six, and the line is *Luottokortin lasku, arvio aiemmista
  laskuista*. A bill up
  to five days late sits on the first day. With fewer than three paid bills, or no bill for 62 days, there is no row.
  The card's purchases are in its bill and not in the everyday spending.
- **A regular transfer** to an account the window does not count (savings, a joint account, an account whose other leg
  the rows do not show) is a row on its day when it is a monthly series of three payments or more. A transfer between
  two counted accounts changes nothing.
- **What it does not hold.** The bill of a card that is not connected is a bill like any other, when the history shows
  it as a series. Its purchases spread over the base months (*Arkimenot päivässä*) are not taken off *Jää palkkapäivänä*:
  the bill holds those up to its day, and the ones after it wait for a bill after the payday. A savings plan to an account that is not connected is no transfer row and is counted once, as the
  subscription it is. Money another member moves into a joint account is no row, so a member whose window starts from
  the joint account's part runs low by the part of it.

## Reports

- *Tulot ja menot* tells the margin and the savings rate from the months that have ended when the period
  holds the running month. The totals above them include it.
- The spending of a range has one owner, `totalsOf` in `analysis/flows.ts`: the expense of *Tulot ja menot*, every
  row's spending with the refunds taken off. Three readers show that total and nothing else. *Kategoriat* divides every
  share by `spendingBase` (`analysis/data-quality.ts`, the same sum over the range's rows), and so does the notice of
  uncategorised rows for the share of *Muut menot*. *Menot kuukausittain* has the month totals and the total as sums of all
  its rows: the themes, *Loput yhteensä* and the large purchases add up to them to the cent, and so does the table of
  every category behind *Taulukko*. `packages/core/test/reports-totals.test.ts` holds the three to the cent for the seeded households.
  The usual month under it is the one figure that leaves rows out: the large purchases (`largePurchases`) of the
  complete months, with the money that came back for them. The bars, the totals and the categories' own sums keep them.
  *Tavallinen kuukausi* has one source, `typicalFlowCents`: the line under the bars of *Tulot ja menot* and the line under the
  bars of *Menot kuukausittain* read it, so the two reports print one sum under one label. The *Keskimäärin kuussa* of the
  category table is the level of its own sums, which keep a debt paid from savings, and the line of *Tulot kuukausittain* is the
  mean of the income months under that label. *Mikä muuttui* starts from the categories' levels added up, labelled *Kategoriat keskimäärin kuussa* (the sum of the table's *Keskimäärin kuussa* column): that sum keeps a debt paid from savings and reads only the months the categories have a level for, so it can differ from *Tavallinen kuukausi*, and the two never share a name. The categories with no level at all (in practice those of a card connected late) are one step, *Ei vertailukohtaa*, and their whole sum is the step. The buffer's *Menot ja lainanmaksut kuukaudessa* is another figure, the
  *Odotettu* month with its loan payments, and does not carry the label. `apps/web/test/usual-month-label.test.ts` lists every reader of the label.
  `spendingChangeReport` (`reports/spending-change.ts`) is an older bridge of a month against its *Odotettu* plan with
  one-offs left out; no page shows it, the findings and the module-host contract still read it, so it stays until
  those move to *Mikä muuttui*.
- A category whose refunds were greater than its spending in the range stays in *Kategoriat* and in the table behind *Taulukko* of *Menot kuukausittain* as a
  row with its minus, last in the order (in the view by theme its theme is under *Loput yhteensä*). Its share is negative, the shares add up to 100 %, and the page shows "–" for
  the share with a line under the table. The previous period is not cut at zero either, so *Muutos* adds up. The
  first page's list *Menot kategorioittain* of the month, which a household with themes (see *Themes*) sees as their
  table instead, has such a category as a row with its minus too, and the categories after the ninth are one row,
  *Muut*, whenever their sum is not zero, so its rows add up to *Menot*.
- *Luokittelematta* on Tapahtumat lists the 50 merchants with the most money out that nothing recognised. Its heading
  counts all of them and their money out, which the server adds up in SQL, so the list can be shorter than the count.
- *Nousseet menot* shows a category that has been over its own level in each of the last three whole
  months: at least 15 % and 40 € a month above the median of the twelve months before, and above the top
  quarter of them. The middle of the three months counts, so one dear month does not carry it. It needs at
  least six earlier months, and a category that was as high in the same months a year ago, mostly bills,
  or tax and card bill categories are left out. It says what a year at the new level costs.
- The price split has one owner, `priceSplit` in `analysis/prices.ts`. A rise from a base period to a current one is
  split into the part prices explain, the base spending at the change of the consumer price index of the category's
  COICOP class (the mean index of each period's months), and the rest, what the household bought more. The two add up
  to the rise to the cent. *Nousseet menot* splits the month's rise against the base months, *Kategoriat* the change
  from the previous period. The index is bundled from Statistics Finland's table 15b5 (`analysis/cpi.ts`) and expires like the other CPI facts; a category
  with no class in `CATEGORY_COICOP`, spending that fell, or a month with no valid index row gives no split.
- *Kiinteät ja muuttuvat* has one column of fixed costs, the charges of subscriptions and bills with
  their loan instalments, and shows debt service outside them apart. The columns add up to the
  spending of the period. It starts with two figures, the fixed costs a month and their share of *Säännölliset tulot*,
  the share a dash where the income or the costs are too small to tell. It has no chart and no sentence.
- *Saldot* draws the total of the connected accounts as an estimate, each counted back from the day the bank
  gave its balance (that day in the app's time zone).
  Its figure is *Tilien ja korttien saldo*: the accounts with the cards' balances in it, on the newest day of the range (the
  end of the last whole month, or today), and the text names that date. Yhteenveto's *Tilien saldo, ilman korttia* is
  `accountsCents`, the accounts without the cards, so the two names never stand for one figure.
  Its change (*Saldomuutos*) runs from the close of the day before the range starts to the close of its last known day,
  so the rows of the first day are in it. When an account has no known balance on that day before, it runs from the
  close of the first month end at which every account is known (the first known day when no month end in the range is
  known), and the answer names that day (`basis: "firstDay"`).

## Cost kinds of the bills

Every bill and loan payment of a month of Laskut is one of four kinds (`costKindOf` in `cost-kinds.ts`), by its category:

- *Asuminen ja välttämättömät*: housing, utilities, insurance, telecom, taxes, fees, and the regular bills of *Lapset* (day care and the like).
- *Lainojen ja korttien erät*: a loan payment whatever its category, and every category of debt service (the card bill, mortgage, consumer
  and student loans, interest, collection). Debt service is never optional.
- *Leasing ja jäsenyydet*: car leasing and memberships.
- *Valinnaiset*: everything else, a subscription among it, and a bill with no category.

The four are summed over the bills still to pay that no card pays, the rows `billsCents` is made of, so the four add up
to the month's bills to the cent (`packages/core/test/bill-calendar.test.ts`). A bill whose sum is not known has no row
and is in no kind, as it is in no `billsCents`; the head of the month counts those. The head of an open month in Laskut
shows the kinds that have money. Raportit > *Menot kategorioittain* gathers the debt categories and the car's finance
in one theme, *Velanhoito*.

## Themes

A theme is a main class of spending, one level above the categories: *Asuminen*, *Ruoka*, *Auto* and twelve more
(`THEMES` in `themes.ts`). Every row that counts in spending has one theme and one line in it (`themeOf`), so the
themes of a period add up to its spending. A line is a category under its own label: *Ruoka* has *Ruokakauppa*,
*Ravintolat ja kahvilat*, *Ruoan kotiinkuljetus* and *Alko*.

- **Rows pulled from other categories.** One theme takes rows out of their categories by their words. *Auto* has the
  car's insurance, which is a row of *Vakuutukset*, the vehicle tax, a row of *Verot, maksut ja sakot*, and a lease
  whatever its category. Its lines say what a car row was for: fuel, charging, parking, service, inspection,
  insurance, tax, a lease and the rest. The car's finance, a row of *Kulutusluotot*, is debt service and counts in
  *Velanhoito*. Home insurance, property tax and a pet insurer's premium are not told apart yet and stay in the theme
  of their category.
- **A household without a car has no *Auto*.** Nobody is asked how many cars there are, so the fuel stands in for the
  answer: *Auto* exists when the months looked at hold six purchases of fuel or charging. Without it the car's own
  categories are lines of *Liikkuminen*, and the insurance and the tax stay where their category is.
- **Money back** counts in the theme and on the line of the payment it takes back, in the month it arrives.

What goes where over a year is `themesReport` in `analysis/themes-report.ts`. The first page's answer carries it as
`themes`, the same whatever period the page shows. The first page draws it as *Menot kategorioittain* (below).

- **The months.** The last twelve complete months before today, never the running one, narrowed twice. First, every
  account with spending in the window was in the data from the window's first day. That day is the account's recorded first day when it has one
  (*Coverage by day*, below) and else its first row, with the three days of slack the oldest row has
  (`isCompleteMonth`): a card connected five months ago makes the window five months, a month an account covers
  in part is not in it, and a card opened or first used inside the twelve months is read the same way. A new card
  narrows nothing when another card of the same bank has rows from a month or more before its first one, and neither
  does a new account when another account of that bank has them: the bank has shown how far back it gives history,
  so the new one had nothing to show before, as when a bank replaces a card. Second, an
  account pays when it has spending in half of the months left or more, and from its first row on a paying account
  must have a row of some kind in every month: a month without one is missing data, a card that stopped syncing, and
  not a month without spending. The window is the newest run of three or more such months, so it can end before the
  last complete month.
  An account with no spending in the months left does not count: a card that ended when another took over moves
  nothing. Under three months there is no answer.
- **A month and a year.** A theme's figure a month is the window's sum divided by its months. Its figure for the year
  is the sum of a window of twelve months, and a shorter window has none: nothing is scaled up to a year. A theme's
  cents a month are shared out among its lines, so the lines add up to the theme and one of them can be a cent off
  its own sum divided by the months. The total a month is the sum of the themes.
- **Large purchases stand apart.** A purchase of the `large` policy (`largePurchases` in `analysis/large.ts`) is in no
  theme: one of at least 500 € that is over a quarter of what the rest of its category took in the twelve months
  around it and is no row of a series, and every row of *Auton osto*. The large purchases of the window are one sum,
  a count of the purchases and the rows the sum is made of, the largest first, each with its day, its payee and its
  cents in the view. Money that came back for a large purchase is one of those rows with its minus, so it lowers that
  sum and no theme. Money in on *Auton osto* that takes back no payment, the old car sold, is such a row too and on no
  line of *Auto*; it is no purchase and the count leaves it out. The rows add up to the sum, and the themes and the
  large purchases add up to the spending of the window to the cent, which `packages/core/test/themes-report.test.ts`
  holds for every fixture household that has an answer, as the household sees it and with every account cut to a
  half. No fixture household has an account with two holders.
- **The change** sets a theme or a line against the twelve months before the window. It needs 24 complete months,
  every account with spending in either year in the data from the first day of the year before, and every paying
  account of either year with a row in each month of both. The year before is placed by the same answer on *Auto*,
  and the change is told only from the gate on: 2 % of the level a month in the year before, and at least 10 € a
  month (`gateFor`).
- **The first page's table** *Menot kategorioittain* takes the place of the month's list of categories when the answer
  has `themes`, and the month switch does not change it: its period, as months and years, is at the right of its
  heading. It draws the answer and computes nothing but its rest row: the seven largest themes as the answer orders
  them, and the others in one row *Muut (n)* whose figures are the sums of theirs. A figure a month, a figure for the
  year only when the window is twelve months, and the change only when some row has one; a row without a change has an
  empty cell. Every theme opens to its lines with a button (*Ruoka* is open when the page opens), except a theme of one
  line that has its name. A line that is a category links to its rows in Tapahtumat over the window's days; the lines
  of *Auto* are no categories and have no link. *Yhteensä* is the sum of the themes. The large purchases are a row of
  their own under the table, with the sum of the whole window, and open to their rows (`ThemesTable.tsx`).

## Coverage by day

`coverage` (`analysis/coverage.ts`) says from which day each account's rows are known, from `account_history` (what a
fetch records: `asked_from`, `first_row_day`, `source`), which the analysis context carries as `history`.

- **The rule.** An account's first known day is its `first_row_day`, the oldest booked row the app holds. When the bank
  was asked for its longest history (`source` `longest`) and sent no row, the day it was asked from (`asked_from`)
  stands: it had nothing to give for the whole of it. A default fetch that found no row proves nothing, since a bank
  may give less than was asked, and neither does a file import. An account linked before 0.46.0 has no record: its
  first day is unknown (*alkupäivä ei tiedossa*), the reports use its first row as before, and its next consent asks
  for the longest history and records the day.
- **A joint account** linked by two members is recorded once by each: the earliest day of the copies counts for all.
- **A month the data does not reach.** The household's data starts on the earliest first day of the accounts that
  pay out more than a tenth of the household's spending over the months each account covers (`householdKnownFrom`). A
  month that ends before it (`monthKnown`) is unknown: a small account's rows there are no month's money. The
  reports give its cell no figure (null, never 0), no comparison, and leave it out of every average and usual level.
  The sums of a range, type, payer and category still add every row, so the tax year and the spending totals keep all
  money. `knownMonths` in `reports/shared.ts` is where a monthly series starts; Rahavirrat does not use it yet.
  Saldot's change column is the plain difference of the totals it shows.
- **A card account.** Where the bank gives a card account (the type code `CARD`, or a masked card number, in
  `accountType`; the link log's `cash_account_type` shows it), its rows are the card's purchases, and the first known
  day of the account is the day purchases are known from (`purchasesFrom`). An account that is no card account gives
  none: a bill paid from a deposit account is one row whatever was bought.
- **The longest history** is asked for by the fetch a consent the user has just given sets off, once for each account
  of the new consent, from the history limit, and recorded (`source` `longest`; the record only moves earlier). A
  background fetch never asks for it: a bank limits the calls a day.

- **Accounts two periods share.** `accountsCoverage` (same file) says which accounts have the whole of two periods:
  those with a row that is no transfer (money in or out), from their first known day (the first 3 days of a month count
  as the month's start) and not ended before the later period's last day. An account has ended when it has no row for
  61 days, or 2.5 times its own median gap between rows when that is longer, before the newest row of the scope, so a
  quarterly bill stays in. An account one period lacks is left out of both sides. The year comparison sums the shared
  accounts month by month; the summary's changes and the category report's changes (`comparedCents`) do the same over
  the period. When the accounts left out carry over a tenth of the later period's spending, no change is told. The
  dashboard's side-by-side figures, the drift check, the year comparisons and the months that cost more than
  usual (with the months of their usual level) sum every account, so they are told only when none is left out.
  The year comparison says how many months it rests on, that accounts were left out, or why there is no comparison.

## Loans

The bank connection shows payment accounts only, so a loan is typed in, pasted or read from a picture, and the household
confirms it. Its payments are still bank rows and stay in the debt flow: a known loan changes no flow. Each figure has
one definition, in `packages/core/src/loans.ts`, and the list of the household's debts behind every debt total is in
`packages/core/src/household-debts.ts`.

| Figure | Means | In core |
|---|---|---|
| Balance on a day | The stated balance moved forward from its date by the repayment plan, one payment at a time. A loan whose plan lacks a field keeps the stated balance and names the field. Before the balance date there is no figure | `loanBalanceOn` |
| Debt total | The sum of those balances. The loans left out or counted at their stated balance are listed with it | `debtTotalOn` |
| Interest over 12 months | The interest parts of the payments due in the 12 months after the day. A loan whose balance stays (no plan, or a bullet loan) owes its rate on that balance for the days before its last due date, and a whole year is balance × rate. A rate that steps to a new one on a day counts each day at the rate in force that day. Without a rate there is no figure, except that a loan that owes nothing costs nothing | `loanInterestNext12Months`, `debtInterestNext12Months` |
| Payoff date | The due date that brings the balance to zero, at the latest the last due date. None when a payment does not cover its interest or a field is missing | `loanPayoffDate` |
| Next payment | The next payment of the plan in full, with its interest and its amortisation. It is never more than what is owed with its interest: the last payment is what is left. A loan that owes nothing has none, and neither has a bullet loan. A payment typed for a loan without a whole plan is told as typed, at most what is owed (with one interval's interest when the rate and the interval are known), and has no parts | `loanNextPayment` |
| Payments a month | Each loan's next payment divided by its interval in months, to the nearest cent with a half cent up, added together. A loan that owes but has no payment with an interval is counted as missing. A bullet loan is counted apart: it pays interest and no instalment | `debtPaymentsPerMonth` |
| Payments a month (Lainat) | The tile *Maksut kuussa*: the saved loans' payments above plus the payments of the unsaved loans and cards (the viewer's part, `UnsavedRow.monthlyCents`). A debt with no figure is counted beside the sum, a saved one that owes with no payment, an unsaved row with none, and a lender paid only a few times. The sum is no figure, never 0, while none is known | `monthlyPayments` in `reports/loans.ts` |
| A move of the reference rate | The payment and the next 12 months' interest with the rate moved by a number of points. The rate falls no lower than the loan's margin, and to zero when no margin was told. The figure says how far the rate moved. An annuity gets the payment that ends the loan on the due date it ends on now, a fixed instalment keeps its payment and takes longer, equal principal pays the new interest on top. Each is read from the schedule the next payment is read from, so the last payment is what is left. Told for a loan with a Euribor reference rate that owes and has a rate, one point down and one up. A fall the rate has no room for is left out | `loanRateScenario` |
| The household's debts | Every saved loan the view holds, and every connected card and loan account that owes something: the list behind every debt total. A saved loan the household linked to its account counts once, as one debt: with the bank's balance and the saved loan's rate and payments while the account's balance is at or below zero and not older than the balance typed for the loan, and as typed otherwise | `householdDebts` |
| Credit use | Balance over limit: 1 is a full line. What is left to draw and what is over the limit come with it | `creditUse` |
| A connected account as a loan | A connected card, an account with a credit limit, or an account of type loan, read as a loan so that its debt and its use come from the same functions. Credit in use is a balance below zero: what is owed is that balance with its sign turned, and nothing when the account is in credit. A bank tells what is owed on a loan account with either sign, so the sync stores a loan account's plus as a minus (`storedBalanceCents`) and an update mends the balances stored before; a card's plus is money the bank owes the holder and stays. A loan account's kind comes from its name (home loan, student loan, car loan, else other loan), never card or credit line, and it has no rate, payment or plan until a saved loan is linked to it. The id is `account:<account id>` | `creditAccountLoan` |

- Money is whole cents and a rate is hundredths of a percent. Interest of one payment interval is balance × rate ×
  months / 12, rounded to the nearest cent with a half cent up (`loanPeriodInterest`). Banks count days, each in its
  own way, so a statement can differ by cents, and by up to 1.4 % of the interest where the bank divides by 360 days.
- With *annuity* and *fixed instalment* the payment holds the interest. With *equal principal* the payment is the
  amortisation alone and the interest comes on top. A *bullet* loan keeps its balance until its last due date.
- Due dates count back from the last due date. Without one the first payment is counted a whole interval after the
  balance date, the latest it can be, so the balance is never told too low. The balance stays between due dates, and
  each payment carries a whole interval's interest.
- On the last due date whatever is left falls due: a bullet loan, or a car loan with a larger last instalment. A last
  due date on or before the balance date is ignored.
- A payment that does not cover its interest grows the balance. A plan that is not paid in 1 200 payments counts as
  never ending.
- Nothing is estimated: a figure that needs a field the loan lacks is empty and names the field.
- A loan can carry the day its rate is reviewed (*Koron tarkistuspäivä* in the loan's form, `Loan.rateReviewDate`). The
  form shows it unless the reference rate is fixed, never requires it and keeps a day that has passed. With a margin it
  gives the loan's rate path (`ratePathOf`), which the schedule and the bill calendar read.
- A loan with a typed or fixed rate can carry one step in it: a day and the rate from that day on (*Koron muutospäivä* and
  *Korko muutoksen jälkeen*, `Loan.rateStepDate` and `rateStepBp`), for a rate that is 0 % until a day and 19,9 % after
  it. Both are given or neither, a day that has passed is kept, and a loan on a euribor has none, since its reviews set
  the rate. The step is the loan's rate path (`ratePathOf`): each interval counts at the rate in force when it starts,
  and an annuity with a last due date sets its payment again at the step. With no typed rate the rate stays unknown.
- A saved loan can be tied to the connected card or loan account that is the same debt, in the loan's form (*Sama velka
  pankin tilillä*, offered when the household has such an account that no other loan holds). A linked pair counts once:
  in the debt total of Lainat, in the accounts less the debts of Saldot and in the Säästövinkit loan area. The balance
  is the bank's while the account's balance is at or below zero and not older than the balance typed for the loan. The
  rate, the margin, the plan and the payments are the saved loan's, and the payoff date is counted from the bank's
  balance on the saved loan's due days, so it does not move from one day to the next. With the account in credit, or
  its balance older than the typed one, the saved loan counts with its typed balance, still once. In the months of
  Saldot before the account's first known balance the saved loan counts as typed.
- A saved loan and an account that are not linked are both in the sums, so a debt the household saved and the bank also
  shows as an account is there twice. The Lainat report names each such set of saved loans once, with the accounts
  beside it (`maybeTwice` in `household-debts.ts`): a connected card beside every saved card and credit line that owes,
  whatever their names, and a connected loan account beside every saved loan that is no card. It says that removing the
  saved loan takes the second one out, and beside each of the household's own accounts it links to the loan's form with
  that account chosen, which counts the pair once. A linked loan or its account is not named. Saldot and the
  Säästövinkit loan area point to the report.
- A checking account below zero is no loan: its overdraft is in the accounts' total and not in the debt total. Beside
  a saved credit line that owes it may be that credit, and then the accounts less the debts hold it twice
  (`overdraftTwice` in `household-debts.ts`). Lainat and Saldot say so where they show that figure, and that the right
  figure is then larger by the saved loan. They advise no step: removing the saved loan would take the debt out of the
  debt total, which holds it once.
- The debt total is one number. The Lainat report, the first page's *Velat yhteensä* (*Lainat yhteensä*, the loans' balances added, is the same figure when no card owes anything; both are named *tiedossa* while a debt with no balance is listed under them), the accounts less the debts and
  the Velat lines of the Säästövinkit loan area all read `householdDebts` (`owners.test.ts` and
  `balances-holdings.test.ts` in `packages/core/test` hold them together).
- The accounts less the debts ("Tilit miinus velat", `accountsLessDebt` of `balanceReport`) are the connected
  accounts' total less the saved loans that are no linked account's debt, each at its balance on that day. Connected
  cards and loan accounts, a linked loan's among them, are in the accounts' total already. The figure holds no home, no investments and no other property, so it is not net worth and
  no page calls it that: the page says what is left out. It is empty for a month that ends before a saved loan's
  balance was told, and the same as the accounts' total without saved loans. Lainat and Saldot tell it for today.
- The Lainat report (`reports/loans.ts`) shows only when the household saved a loan. Which saved loans a view holds,
  and at what part, is told in *Joint accounts*. Its interest total
  leaves out the loans that owe and have no rate (`loansWithoutRate`, the count Säästövinkit reads too), and its
  payments a month leave out the loans without a payment and an interval and a loan whose balance is dated after
  today; the page does not count them. The line of a move of the reference rate names the payment only when the move has one,
  and a move with no figure has no line. A payment made less often than monthly is spread over its interval, and a payment
  without an interval is shown without one. The interest and the amortisation of a payment, and the viewer's part of a loan,
  are values with a label of their own. The date a loan ends is "Viimeinen eräpäivä". What is not known is a dash on the page,
  never zero; the page asks nothing, and *Tarkistettavat* asks for the one fact a saved loan or a connected card that owes
  lacks. A connected credit card is a row of *Käytetty luotto* and, when the account has a limit
  and the viewer has the whole card, *Luottoraja*, with none of a loan's terms.
- The Säästövinkit loan area reads a saved mortgage where there is one: its margin and reference rate answer for the
  `loan_rate` question, its balance is the loan's balance today (the bank's balance when the mortgage is linked to its
  loan account), and paying it down early is counted at its own rate
  instead of a range of Euribor months. A saved mortgage with a fixed rate is asked nothing, as when the household
  answers that its rate is fixed. The mortgage is the saved one linked to the payment series, else the saved
  mortgage that owes most. Without a saved mortgage the area asks and counts a range of Euribor months.

## Säästövinkit

- A finding's euros are a year: the last 12 complete months, or 6 to 11 complete months scaled to a year with one
  step less certainty. Under six complete months there are no euros, under three only deadlines.
- Each finding has a low, a mid and a high figure. The page shows the mid.
- A finding needs a mid of at least 120 € a year. A deadline has no euros.
- The car's running cost holds leasing, and a car bought is shown apart. The answer counts the checks of the areas: all of them, those waiting for a number, a fact or
  months, and those with no rows to read, which did not look at anything. No page shows the counts.
- A one-off (`oneOffs` with the level policy, the one every view uses, ADR 0005): a purchase over three times its usual ticket (its merchant's median, else its category's in other months) and at least 50 €, or 150 € with no ticket. Listed struck and left out. Transfers never
  count, and an account whose first row falls inside the window is left out of it.
- The headline adds the mids of the findings shown, largest first. It leaves out a decided finding, one at matala
  certainty, one decided together with others (a yhtiökokous or two people) and one whose money is mostly counted
  already: over half of what it claims (rows, a series, a merchant, a category or an account) belongs to a finding
  counted before it.
- A national figure comes from a dated fact with an expiry date (reference rates, CPI and electricity prices six months
  after the period they describe, price lists and surveys twelve). An expired fact hides its comparison.
- The follow-up compares the months after a done decision with the months before it and confirms a saving when the
  monthly effect reaches 80 % of the mid's monthly share and every month after is below the level before.
  A contract costs its series' *kuussa* on both sides, so an unchanged fee with a free July reads the same before and
  after. Electricity bills are compared with the same months a year earlier and are at most likely, never confirmed, because
  the use behind them is a typed figure.

## Bills paid another way

A series knows only its own rows: one account, one payee name. A bill the household paid from another account, or by
hand under another payee name, would stand as falling due. `settlePaidElsewhere` in `recurring-settled.ts` reads the
view's rows once, when the analysis context is built, and marks the occurrences of a bill that such a payment settled
(`settled` on the series). Nothing is stored: when the paying row goes away or its booked twin arrives, the answer
follows the rows.

- A row settles an occurrence of a subscription or bill when it is money out, no transfer, booked or pending, dated
  today or before, a row of no series of its own, and dated from 31 days before the occurrence's date to the cadence's
  tolerance after it, and not nearer the series' previous charge. The series' next date moves a step past it.
- With the series' payee name, the sum must be the bill's usual one (a bill by use: inside the range of its last six,
  widened by 10 %). Under another payee name the row needs proof as well: the bill's payment reference (one reference
  every invoice shares, or invoices numbered on from a prefix) with a sum within 25 % of the usual one, or the
  creditor's IBAN that the series' own rows have carried twice or more with the usual sum. Never the sum alone.
- A series on a credit card is left as it is. A row on the series' own account that is no row of it is a purchase, not
  another way of paying, unless it is pending.
- The paying row keeps its payee, category and account, and counts as a fixed cost with the series.
- One row settles one occurrence of one series, the one nearest its date. While the payment is pending on a counted
  account, the bill stays a row of the window and of Laskut's list, marked *varaus* (*What the window holds*).
- Accepted miss: the first charge of a second contract at one payee, paid from another account, can hide the first
  contract's bill until the first contract's own charge comes.

## Joint accounts

A joint account is a real account that more than one member of the household uses. A member's own view (*Oma talous*)
counts it at the member's part, and *Koko talous* counts it whole. ADR 0016 says why. A part of an amount is worked out
in one place, `partCents` in `account-use.ts`, and `accountsInView` in `services/analysis.ts` decides which accounts a
view holds.

**Who uses an account** (`deriveUse`, `saidUse` and `partOf` in `account-use.ts`, `usesInView` in
`services/account-use.ts`)

- Nobody has to say it. The bank's line of holders gives it on every read and the answer is stored nowhere. An account
  with two holders or more is joint: each holder who is a member of the household is a user, the holders who are no
  member are one user together, and a member who linked the account is always a user. Everyone weighs the same, so the
  parts are equal. An account with one holder, none, or a line not read yet is used by the members who linked it, except
  that an account whose one holder is another member is that member's alone (a child's account a parent linked).
- A member is matched to a holder by the name the member's own accounts give. That name stays on the server: a page
  gets display names.
- The member who linked an account can say its use in *Asetukset > Tilit*: the users and the weight of each, typed as
  euros a month ("600" and "400"). Only the ratio counts, and an empty field or 0 leaves a user out. *Palauta pankin
  tiedoista* takes what was said back, and the bank's holders decide again.
- One statement holds for the real account, whoever linked a copy. A joint account that both partners linked reads the
  same in both copies, and what either partner says replaces what was said. A statement gives nobody access to the
  account: a user it names who cannot see the account sees nothing of it, and the page offers the share beside it.

**What a member's own view holds** (`applyUse` in `account-use.ts`)

- The accounts are the member's own and the ones shared with the member, each when the member has a part of it, and
  each real account once (the member's own copy when both partners linked it). An account that other members use alone
  is left out, whoever linked it.
- A row of a joint account has the member's part as its amount and the bank's amount beside it (`wholeCents`), so every
  report follows with no change in it. The sums read in SQL (the sums above the list on Tapahtumat, those of Kauppiaat)
  use one expression that a test holds equal to `partCents`. Tapahtumat shows the bank's amount with the part beside
  it, and the transaction export has the bank's amounts.
- The balance and the credit limit of a joint account or a card are the member's part, so *Yhteensä* of Varat ja velat and
  a card's used and free credit follow.
- Where a joint account is cut by who paid its rows (`mode: "source"`), the past counts each row by who paid it, and
  what is ahead (the series, the fixed costs, the bills before the payday) counts each series at the viewer's part of its
  recent rows (`standingCut`): what the trace says they paid, plus their weighted part of the money nobody owns, the way
  the past counts a row. With no recent row in the trace the weights cut it. The members' amounts of a series add up to
  the bank's, to the cent.
- A view settles a bill only by the rows it holds: a bill another member paid from an account the viewer does not see
  stays due in the own view and is paid in *Koko talous*. Sums are compared as the bank booked them (`billCents`), so
  a bill the member's part of a joint account paid is settled by the bank's whole sum of the row.
- Money a user pays into a joint account is a transfer: it pays for that user's part of what the account pays. A
  movement between two members' accounts is a transfer in every view, and a movement to or from an account that no
  member connected is money between people (*Maksut henkilöille*, *Maksut henkilöiltä*). A category set by hand is
  never changed, and two rows of one member that the member's own categorisation left unpaired are never paired here.
- A debt follows who uses the account behind it (`householdDebts`). A connected card or loan account has its own part,
  a saved loan linked to one has that account's, and a saved loan with no account has the part of the account its
  payments leave. A saved loan stays whole in the list of debts and each of its cent figures is cut once, at the end
  (`debt-part.ts`), so the users' parts of its balance, payment and interest add up to the loan.
- In Koko talous the income report splits a joint account's income between its users by their parts, and its *members*
  list them. An account one member uses is that member's, whoever linked it. An own view has no split: its rows are
  the member's part already.
- Säästövinkit counts joint accounts whole in both views, because a contract is the household's and half an electricity
  bill set beside a market price would be wrong advice, and the page says so. The match of a typed bill, the
  match of a loan's payments and Säästövinkit read the bank's amount, `billCents`, and not the part.

**Koko talous** counts every account whole: the member's own, also one that other members use alone, and the ones shared
with the member. A joint account that both linked is there once, as the viewer's copy. Money between members is a
transfer in it. It exists when somebody shares an account with the member, or when one of the member's own accounts is
at less than the whole.

**The figures add up.** For members who see the same accounts, one member's own view plus the other's is Koko talous,
to the cent. The users' parts of a row add up to the row: a user's part is the cents up to the end of their range of the
account less the cents up to its start, each rounded half up (`partCents`), and the ranges follow one another in the
order of the user ids. So each part is within a cent of the exact share, and with two users a cent that cannot be
split goes to the user whose id comes first. A case, with Aino and Eero saying 600 and 400, parts of 3/5 and 2/5:

| | Aino's *Oma talous* | Eero's *Oma talous* | *Koko talous* |
|---|---|---|---|
| The joint account's balance | 600,01 € | 400,00 € | 1 000,01 € |
| A mortgage paid from it, left | 89 999,99 € | 60 000,00 € | 149 999,99 € |
| Its payment a month | 504,01 € | 336,00 € | 840,01 € |

What adds up so: balances, debts, a loan's balance and its payment a month, spending and its curve over the days, the
money out on Tapahtumat, and the income report (its *members* in Koko talous are the two own views' earned income).
What does not: statistics that cannot add up (an average, a median, the smallest and largest of a month, a threshold,
the usual spending), Tapahtumat's money in in Koko talous, and the payday window.

**Loans** (`loansInView` in `services/loans-in-view.ts`)

- A saved loan is its typist's: the list of loans and every change read the typist's own rows, and a change to another
  member's loan is answered as for a loan that does not exist. Which account pays a loan is told by its series key alone
  (`Loan.seriesKey`, read by `paidFrom`), the id of the payments' series, which holds the account they leave.
- A view holds the viewer's own loans and, of the loans other members typed in, the ones paid from an account of the
  view. In an own view that is a joint account the viewer and the typist both use, and the loan is cut by the viewer's
  part of the account, so the users' parts add up to the loan. Koko talous and Säästövinkit count their accounts whole
  and hold the loan whole, when the typist linked a copy of the account or is named a user of it at any weight. A
  member who sees the account only by a share, never linked a copy and is not named a user keeps the loan alone in the
  others' Koko talous.
- A loan with no payments linked is its typist's alone in every view, and in an own view so is a loan paid from an
  account one person uses.
- A loan that two members typed in counts once. Of two loans paid by one series of payments a view holds the viewer's
  own, or else the first typist's by user id. Two loans of one typist on one series both stay.
- The row of another member's loan says whose it is (*Lisännyt Aino*, `Loan.typedBy`, the display name). The viewer sees
  its name, lender, kind, balance, rate, plan and payments in Yhteenveto and in Raportit, and can neither list, change,
  link nor remove it. It names the viewer's copy of the account, never an account the viewer cannot see.

**A card another member linked** (the block "Money into a card" in `applyUse`). In an own view a payment that is the
bill of a card another member linked is a transfer and not spending, as it is for the member who linked the card: the
card's purchases are the spending, at the member's part of the card. The payment is the one of the same sum, within five
days, out of an account of another member than the card's linker, which that member's own categorisation left open. It
can leave that member's own account or their copy of a joint account. Without this the bill counted beside the
purchases.

**The payday window** follows the counted accounts (*Which accounts it counts* in *The days to the payday*). The windows
of two members do not add up to Koko talous's, by design. A member with a checking account of their own does not count
the joint account and sees a regular monthly transfer to it as a row, and the mortgage the joint account pays is no row
there. Koko talous counts every account: the mortgage is a row, and a transfer between two counted accounts changes
nothing. Each window answers whether that member's own money lasts to the pay.

## When it gets something wrong

- Change the category in the transaction list. *Sama kategoria kauppiaan muille tapahtumille* also creates a
  rule for old and new transactions.
- The category *Omat siirrot* removes a transaction from every total.
- Fix an account's type under *Asetukset > Tilit*. The type decides how transfers and savings are read.
- Set one category for a merchant under *Tapahtumat > Kauppiaat*. It applies to every row of that
  merchant, old and new, and removing the merchant's rule returns it to the built-in rules and the trade register.
- Write your own rules under *Tapahtumat > Säännöt*. A rule is plain words, such as a merchant's name, and
  matches whole words. Case does not matter, and ä and å match a, ö matches o.

A category you set by hand never changes by itself, not even after an update.

Known limits of the joint account:

- The sums above the list on Tapahtumat go by the mark stored on a row. A payment between members is a transfer in
  both members' views when the row names the other account's IBAN. A leg that names none and is paired by amount and
  day is marked as a transfer in Koko talous only, so it can still be in those sums in a member's own view.
- A card that only one partner linked, its bill paid from the joint account: in the Koko talous of the partner who did
  not link the card the bill is still counted beside the card's purchases. The own views and the linker's Koko talous
  are right.
- The same shape with a savings account (a joint account that both linked pays into a savings account one partner
  linked and shared) is still spending in the other partner's own view.
- In a payday window whose parts of the card and of the paying account differ, the card's row is the member's part of the
  card's use, while the paying account falls by the member's part of the bill.
- With a checking account of their own and the pay on the joint account, the block *Erääntyvät maksut* of a member waits for their part
  of a pay, which the balance never gets.
- A saved loan linked to one person's account and paid from a joint one counts whole in its typist's own view and at a
  part in the others', so the own views add up to more than the loan.
- Two members with one display name are one line in the income report's split in Koko talous.

