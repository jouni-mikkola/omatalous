# How transactions are counted

Every transaction lands in exactly one flow, so nothing is counted twice or left out.

| Flow | Means | Shown as |
|---|---|---|
| Kulutus (spending) | goods and services | Menot, categories, merchants |
| Velanhoito (debt) | loan payments, financing, interest, collection | part of Menot, own group in reports |
| Säästöt (savings) | savings accounts, funds, shares, crypto, gold, pension savings | savings rate, cash flow |
| Tulot (income) | salary, benefits, dividends, sales, refunds of costs | Tulot |
| Luotonnostot (borrowing) | credit drawn to an account, loan payouts | cash flow and *Yli jäi*, never income |
| Siirto (transfer) | money between your own connected accounts | not counted |

## Definitions

A figure has one definition, in `packages/core`, and the month page, the reports and Laskut all use it.

| Word | Means | In core |
|---|---|---|
| *Valmis kuukausi* | A month that has ended and that the history covers from the 1st. The running month and a first, partly fetched month are not complete | `isCompleteMonth` in `analysis/usual.ts` |
| *Tavallisesti* | The median of the last six complete months before the month in question, in whole cents. With fewer than three complete months there is no usual level and nothing is compared with it. A month's usual spending is the median of those months' totals, on the same days for a running month: the forecast, the pace chart and *Menojen muutos* say this one figure | `usualCents`, `completeMonthsBefore`, `usualSpending`, `usualSpendingOver` in `analysis/usual.ts` |
| *Tavalliset tulot* | The median earned income of the last six complete months before the month in question, in whole cents, and none under three. Earned income is every income row except money from people and refunds, which the income report shows apart. The buffer report, the fixed costs and debt service shares, the overview and *Tilanne* on Säästövinkit divide by this one figure, so their sentences name the same income | `isEarnedIncome` in `analysis/income.ts`, `usualIncome` in `analysis/usual.ts` |
| *Säästöaste* | Saved / income, where saved is the savings flow (savings categories and transfers into your own savings accounts). It is negative when savings were drawn on and empty without income. A running period tells it from its complete months (`settled` in the dashboard) | `PeriodTotals.savingsRate` in `analysis/flows.ts` |
| *Yli jäi* | Income + credit drawn − spending − saved: what stayed on the accounts. Negative when the accounts were drawn on. See *Yli jäi and borrowed money* | `PeriodTotals.leftCents`, summed in `totalsOf` in `analysis/flows.ts` and nowhere else |
| *Katettu luotolla*, *Katettu säästöistä*, *Tileiltä tai kortilta* | How a period that took more than its income was paid for: with credit drawn in the period, with money taken out of savings, and the rest from the accounts or a connected card, which the totals cannot tell apart. `coverOf` also gives what the drawn money left (`creditLeftCents`, `savingsLeftCents`), so no view subtracts | `coverOf` in `analysis/flows.ts` |
| *Kuussa*, *vuodessa* (a series) | What a subscription or bill costs: its typical charge times the charges it makes in a year, and a twelfth of that a month. A monthly series with a year of history counts its own charges of the last twelve months (11 for day care that is free in July), and a bill that varies (electricity) is what its last twelve charges came to. Fixed costs, new subscriptions, renewals and price rises read these figures, and so does Säästövinkit: its 120 € gate for a renewal is the series' own year, and its follow-up counts the series' own charges a year | `RecurringSeries.perMonth`, `monthlyCents`, `yearlyCents` in `recurring.ts` |
| *Kiinteät menot* | An active subscription or bill, per month: its spending and its debt service (a loan instalment). The credit card bill is left out, since it pays everyday purchases, and so is a monthly saving | `isFixedCost`, `fixedSplit`, `fixedMonthlyCents` in `commitments.ts` |
| *Tilaus* | An active fixed-amount series in subscriptions, fitness, entertainment, education, shopping or other. Telecom, insurance, housing, utilities, memberships and loans are contracts: they are fixed costs and are not subscriptions | `isSubscription`, `subscriptionsMonthlyCents` in `commitments.ts` |
| *Sopimus* | A fixed cost that is not a subscription, spending or debt service only: phone, insurance, housing, utilities, day care, a loan instalment. On Laskut, *Sopimukset ja laskut* and *Tilaukset* add up to *Kiinteät menot* | `isContract` in `commitments.ts` |
| *Säännöllinen säästäminen* | An active monthly saving, such as a fund saving plan. It leaves the account like a bill, but the money is kept, so it is neither a fixed cost nor a contract. Laskut shows it on a card of its own | `isSavingsPlan` in `commitments.ts` |
| *Kuussa* (a merchant) | A merchant with an active series shows that series' figures per month and year. Any other merchant: its money out over the last 12 complete months, own transfers left out, divided by their number, and empty without a complete month. Kauppiaat and the merchant summary show this one figure, whatever the period | `merchantBasis`, `merchantMonthly` in `commitments.ts` |
| *Odotettu lasku* | A bill the household typed in, repeated by its cadence: once, quarterly, half yearly or yearly | `ExpectedBill`, `expectedDates` in `commitments.ts` |

Monthly averages divide by complete months only, so a running month never pulls an average down; a category or pivot
average without one complete month is empty. A year comparison needs three whole months in both years. Money saved to an
own account or fund that is not connected (`own_unconnected` in Tietojen laatu) counts as saved, and the data quality card
names the sum and the largest payees, so a missing connection shows.

Tapahtumat's *maksettu* and *saatu* leave own transfers out, and so do a merchant summary's sums and its category. The
row count still includes them, and the page says the transfers are not in the sums.

## Yli jäi and borrowed money

*Yli jäi* is what a period left on the accounts: income + credit drawn − spending − debt service − saved (ADR 0014).
`totalsOf` holds the sum, and the month page and the cash flow report read `leftCents` from it. The figure is the same
number the rows give with no flow in between: the sum of every row on an account that is not a loan, less the transfer
rows (a pair cancels itself, so this takes away the legs with no other half in the period), less the money moved into
savings accounts, which is *Säästöön*. A card account is in the sum, since a card purchase is spending on the day it is
made. `packages/core/test/totals.test.ts` holds this to the cent for the demo, the seeded households and random rows.

Credit drawn (*Luotonnostot*) is money on the account that is not income. It is in *Yli jäi* and in no income figure,
savings rate or margin (`netCents`). A household that buys a car for 13 000 € with a pay of 3 000 € and a credit of
20 000 € has *Yli jäi* 10 000 €, and the bridge says the 10 000 € is credit.

When a period took more than its income, `coverOf` says how the gap was paid. Money has no label, so the order is a
rule: the income pays first, then the credit drawn in the period (*Katettu luotolla*, at most the credit drawn), then
money taken out of savings (*Katettu säästöistä*), then the accounts and the connected cards (*Tileiltä tai kortilta*,
which is how far *Yli jäi* is below zero). The third cover never says that money on an account paid: an account may
have grown while a card owed more, and `PeriodTotals` holds no balance of either, so the tile and the sentence ("Ero
katettiin tileillä olleilla rahoilla tai luottokortilla.") name both. Credit goes before savings so that a month paid
with both never shows less borrowing than there was. Drawn money that paid for nothing is in *Yli jäi*. The bridge (`SurplusBridge`, its parts in
`components/month-parts.ts`) is one sum, and its strip, bar, figures and table are parts of it:

    income + credit drawn + savings drawn + from the accounts = spending + debt service + saved + credit paid back + Yli jäi above zero

Its sentence names the covers with sums the figures show, and a credit line gives the credit drawn with the debt
service of the period under the tile's own word ("Luottoa nostettiin 20 000 €, velanhoitoon meni 1 200 €."). How much
of the credit is in *Yli jäi* is said only when no debt was paid in the period: with a payment beside it, the split is
true by the order rule alone. Neither calls borrowed money income, and neither says more was spent than earned
without saying how the difference was paid.

The bar is drawn only when there is income and no part is below zero (`bridgeDraws`): then every part of the strip and
the bar is zero or above and the two are one sum on one axis. A period with no income, with refunds above purchases or
with income taken back is told by the table alone, every row signed and the last row *Yli jäi*, with the same
sentences under it and nothing told as a share of the income.

## Cases

| Case | Counted as | Why |
|---|---|---|
| Purchase with a credit card (e.g. Nordea Gold, Platinum, Mastercard) | spending, on the card account | purchases count where they happen |
| Card bill paid from the current account, card account connected | transfer | otherwise the purchases would count twice |
| Same, card account not connected | spending ("Luottokortin lasku") | otherwise the purchases would be missing |
| Bill of another card of the same issuer (Platinum while only Gold is connected), or of another issuer's Gold | spending | only the connected card's purchases are counted on its account |
| Bill for a card that is not connected (e.g. Amex) while another card is | spending | only the connected card's bill is a transfer |
| Payment to a card issuer such as Nordea Rahoitus or Bank Norwegian | card bill if the amount changes every month, debt if the same amount comes again and again | an instalment repeats, a card bill follows the purchases. A text with a loan word (*osamaksu*, *laina*) stays a loan |
| Money into the card account ("Maksu, kiitos", prepaying) | transfer | money into a card is a payment, not income |
| Credit moved from a card to the current account | transfer if both are connected, otherwise borrowing | borrowed money is not income |
| Nordea Rahoitus instalment (car, appliance) | debt ("Kulutusluotot") | Nordea Rahoitus is also the lender of Nordea credit cards; a card word in the text makes it a card bill |
| Mortgage payment | debt ("Asuntolaina") | |
| Loan payment text (*lainanmaksu*, *lyhennys*) to a bank that lends mortgages (Nordea, OP, Danske, S-Pankki, Aktia and others) | debt ("Asuntolaina") | other lenders' loans are "Kulutusluotot" |
| Mortgage account connected | its own rows are not counted; the payment from the current account stays debt | the loan account only mirrors the payment |
| A housing company's charge for its own loan (*rahoitusvastike*, *yhtiölaina*, or a loan named by its purpose such as *remonttilaina*) | spending (housing); debt when the text says *lyhennys* or *lainaosuus* | the company owes the loan and the shareholder pays a charge, so it is never proposed as a loan to save |
| Student loan, collection, late interest | debt | |
| Loan paid out to an account | borrowing | |
| To your own connected savings account | transfer, counted as saved on the savings side | |
| "Oma siirto" to an account that is not connected | savings | |
| Nordnet, funds, OST, crypto, investment gold | savings | |
| Selling investments back to the account | savings go down, not income | |
| Dividends, deposit interest | income ("Osingot ja korot") | |
| Salary, holiday pay | income ("Palkka") | |
| Kela, unemployment fund, pension, tax refund | income ("Etuudet") | |
| Insurance payout | income ("Hyvitykset") | premiums are spending ("Vakuutukset") |
| Back taxes, vehicle tax, fines, municipal fees | spending ("Verot, maksut ja sakot") | |
| Union or unemployment fund fee | spending ("Jäsenmaksut") | |
| Rent received from a tenant | income ("Muut tulot") | a sender who pays about the same amount in three or more months is regular income |
| Refund from a shop | spending goes down in the same category | a refund cancels a purchase, see *Money that comes back* |
| MobilePay to or from a person | spending / income ("Maksut henkilöille", "Maksut henkilöiltä") | names like Elisa or Helen are people here, not companies |
| MobilePay to a business (name ends or starts with Oy, Ky, ry and the like) | spending in the business's category | a company form in the payee name rules out a person |
| Tori.fi, Vinted, Huuto.net | income ("Myyntitulot") | |
| Cash withdrawal | spending ("Käteisnostot") | |
| Bank fees | spending ("Pankkikulut") | |
| Pending card payment | counted, replaced by the booked row on the next fetch | your own category choice moves with it |
| Money between members in the *Koko talous* view | transfer | it stays in the household |
| Joint account connected by both | one copy in the *Koko talous* view | matched by IBAN |

## Money that comes back

Money that returns a payment is not income. Known shops already do this: a refund gets the shop's category,
so its spending goes down. For the rest, the app looks for the payment that a returning row cancels. The
returning row takes that payment's category and shows a *palautus* badge in the transaction list. It is
decided from the rows alone on every reprocess, so changing the payment's category by hand moves the
refund with it. A category you set on the returning row stays.

Only rows that nothing else recognised can be returns: unrecognised money in, a text with a refund word
(*hyvitys*, *palautus*), and MobilePay from a person. Salary, benefits, insurance claims and rows with
a category you chose are never matched.

| Case | Matched when | Result |
|---|---|---|
| A shop pays back | same merchant on the same account, the purchase is up to 120 days earlier and at least as large, in full or in part | the purchase's category goes down by the refund |
| A person pays back | same person on the same account, exactly the amount you sent them, up to 90 days later | *Maksut henkilöille* goes down |
| Friends send their shares | the bill was paid to a business, and within 10 days one person sends the whole amount, or at least two different people send the same share and the bill divides into 2 to 8 such shares (cent rounding allowed) | the bill's category goes down by the shares |

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
- A refund after 120 days, one larger than the purchase and one to another account stay income. A shop
  gets 120 days because that is how long a card dispute runs, and a cancelled trip or a complaint can take
  as long. A person gets 90, since only an exact amount from the same person is evidence.
- Reports use the same pairs. A purchase that was paid back leaves the lists of largest purchases, merchants,
  habits and double charges by the amount that came back, and it also counts when a rule had already
  given the refund the shop's category.

## Alerts

The overview shows up to six alerts above the insights, for the selected period. They are about money
that may be going to waste. Clicking one opens the transactions behind it.

| Alert | When it shows |
|---|---|
| *Sama veloitus kahdesti* | The same merchant, amount and day twice on one account, at least 20 €. A merchant that does this often (two cinema tickets) is left out. A monthly bill paid twice within a week counts too |
| *Myöhästymiskuluja* | A payment text with *muistutusmaksu*, *viivästyskorko*, *perintäkulu* or *karhumaksu*. Shows the total and the merchants |
| *Kaksi äänikirjapalvelua* and the like | Two or more active subscriptions of the same kind: audiobooks, music, cloud storage, video. Video is shown as information only, the others as a warning |
| Category spike | A category that rose in the month against its usual level in the *Menojen muutos* report, by the report's gate or more and out of its own noise, with the report's amount and usual level (ADR 0013). Every category is read, also one the report's table folds into *Muut*. The month is the report's: the one the period ends in, so Kuukausi, 3 kk and Vuosi that reach today all tell the running month, and last month's spike shows when that month is selected. The rise in purchases that are no one-off and no bill or subscription of a month or longer must be at least 50 €, over half the usual level, from three or more purchases, most of the category's rise and above every usual month, so a sofa, a car repair, a new subscription or a bigger bill is not a spike. A running month is set against the same days of the usual months (*Tavallisesti tähän mennessä*); when the rows end before today, the alert names the day both figures are cut at (*10.10. mennessä*). A month that was as far above usual a year ago does not count. Before a year of history, December gifts and shopping and summer trips and outings do not count either. Uncategorised rows and loan payments never alert |
| *Käytätkö vielä: …?* | An active subscription that the recurring detection marks for review: a service of 3–15 € a month (a gym up to 60 €) that has run for half a year. Shown when the period reaches today, two at most |
| *Pankkikuluja … vuodessa* | Bank fees and interest add up to over 100 € a year, judged over at least six months and 150 days of data. Reminder fees and late interest have their own alert |
| *… kertaa kuussa* | A merchant with at least eight small purchases a month (median under 10 €) over the last 90 days, with the yearly sum. Fixed costs, cash and payments to people are left out |

Alerts only read the data, so fixing a category or a transfer can remove one.

## Periods, fixed costs and insights

- *3 kk*, *6 kk* and *12 kk* are the last whole months. *Tämä kuu* runs to today and is compared with the
  same days of the previous month. *Tämä vuosi* runs to today; its savings rate counts its complete months,
  because the running month has its bills but often not yet its salary.
- *Kiinteät menot* are the active subscriptions and bills (rent, loans, insurance, day care, phone),
  per month over a year. A monthly fee with a year of history costs what its last twelve charges came
  to, so day care that is free in July counts 11 charges and electricity counts the winter too. The
  credit card bill is not a fixed cost; the month forecast still expects it.
- The month forecast is what has gone so far, the bills still due this month and the usual everyday
  spending for the days left (the median of the last six complete months, per day). A merchant marked as
  cancelled is not expected. Bills the household typed in count while they are still to pay this month:
  one that the history shows as a series is left out, and so is one for which a row of about the same
  amount (within 5 %) was booked in the month before its date. The overview shows the forecast as a range:
  the forecast plus and minus the median error the same forecast made on the household's own last six
  complete months, each taken with the same number of days left and without typed-in bills, and never
  below what has been spent. A month counts when a complete month comes before it; under three such
  months the typical errors of two test households apply instead: 8 % on the 5th, 6 % on the 10th, 2,5 %
  on the 20th and nothing on the last day, interpolated in between. The tile names which of the two it
  rests on.
- The pace chart, in the forecast card, compares the month with *Tavallisesti*: for each day, the median cumulative
  spending of the last six complete months, so its last day is the usual month and today's point the usual so far.
  Under three complete months there is no line.
- *Menojen muutos* (*Kuukausi > Viime kuu*) sets the month against its usual total and splits the change into
  causes by category. A category's usual level is its own median with its one-offs struck. Medians do not add up,
  and a level leaves its one-offs out, so the categories' levels add up to more or less than the usual month. The
  difference is in *Muut* as *Kuukausien vaihtelu*, which is no cause and can make the usual of *Muut* negative.
- *Seuraavat 30 päivää* lists the pay days (active income series), the subscriptions and bills the
  forecast expects (also savings plans, which leave the checking account) and the bills the household
  typed in, by the same two rules. A monthly salary comes on its usual day of the month (the median of
  the days it was paid on), on the Friday before when that is a weekend. With a checking balance, own and
  shared, it adds the balance at the end of each day: the balance now plus the pay days, minus the bills,
  minus the usual everyday spending per day from tomorrow on. The lowest point and its date say when the
  balance is thinnest. Transfers between own accounts are not in it, because the recurring detection
  leaves them out. Kuukausi shows the totals, the pay days and the balance. The bills of the same rows
  are listed in *Tulossa* on Laskut, and their sum is the *Menoja* figure of the card.
- Insights say what changed in the period. A month is compared with its usual level (the median of the
  six months before) and shown only when it is outside all of them; a longer period is compared with the
  previous one. A running month has none. The largest purchase is shown from 200 €, and the weekly food
  shop is not a purchase. Debt service is mentioned when it takes over a third of income.

## Reports

- *Tulot ja menot* tells the margin and the savings rate from the months that have ended when the period
  holds the running month. The totals above them include it.
- A purchase that was paid back in full is not a largest purchase, a merchant total or a double
  charge; a partial refund takes its part off (see *Money that comes back*).
- *Uudet kauppiaat* lists shops that came into use after the first three months of history and where the
  household bought at least twice. Bills, subscriptions and payments to people are left out.
- *Nousseet menot* shows a category that has been over its own level in each of the last three whole
  months: at least 15 % and 40 € a month above the median of the twelve months before, and above the top
  quarter of them. The middle of the three months counts, so one dear month does not carry it. It needs at
  least six earlier months, and a category that was as high in the same months a year ago, mostly bills,
  or tax and card bill categories are left out. It says what a year at the new level costs.
- *Harvinaiset laskut* on Laskut sums the bills that do not come every month (every second month,
  quarterly, half yearly, yearly) for each of the next twelve months, from the recurring detection, and
  says how much to set aside a month. Pet food, shops and clinics are purchases and are not listed. It is
  always about today.
- *Kiinteät ja muuttuvat* has one column of fixed costs, the charges of subscriptions and bills with
  their loan instalments, and shows debt service outside them apart. The columns add up to the
  spending of the period. It starts with the fixed costs as a share of *Tavalliset tulot*, the same share the
  overview's insight and *Tilanne* on Säästövinkit give. With a balance on a savings or checking account it says how many
  months of usual spending, groceries included, that money covers against a buffer of three months, and names
  the gap below it. Under three complete months it gives the date the figure appears. Without a balance it says
  where to add one.
- *Saldot* draws the total of the connected accounts as an estimate, each counted back from the day the bank
  gave its balance (that day in the app's time zone).

## Loans

The bank connection shows payment accounts only, so a loan is typed in, pasted or read from a picture, and the household
confirms it. Its payments are still bank rows and stay in the debt flow: a known loan changes no flow. Each figure has
one definition, in `packages/core/src/loans.ts`.

| Figure | Means | In core |
|---|---|---|
| Balance on a day | The stated balance moved forward from its date by the repayment plan, one payment at a time. A loan whose plan lacks a field keeps the stated balance and names the field. Before the balance date there is no figure | `loanBalanceOn` |
| Debt total | The sum of those balances. The loans left out or counted at their stated balance are listed with it | `debtTotalOn` |
| Interest over 12 months | The interest parts of the payments due in the 12 months after the day. A loan whose balance stays (no plan, or a bullet loan) owes its rate on that balance for the days before its last due date; a whole year is balance × rate. Without a rate there is no figure, except that a loan that owes nothing costs nothing | `loanInterestNext12Months`, `debtInterestNext12Months` |
| Payoff date | The due date that brings the balance to zero, at the latest the last due date. None when a payment does not cover its interest or a field is missing | `loanPayoffDate` |
| Next payment | The next payment of the plan in full, with its interest and its amortisation. It is never more than what is owed with its interest: the last payment is what is left. A loan that owes nothing has none, and neither has a bullet loan. A payment typed for a loan without a whole plan is told as typed, at most what is owed (with one interval's interest when the rate and the interval are known), and has no parts | `loanNextPayment` |
| Payments a month | Each loan's next payment divided by its interval in months, to the nearest cent with a half cent up, added together. A loan that owes but has no payment with an interval is counted as missing. A bullet loan is counted apart: it pays interest and no instalment | `debtPaymentsPerMonth` |
| A move of the reference rate | The payment and the next 12 months' interest with the rate moved by a number of points. The rate falls no lower than the loan's margin, and to zero when no margin was told; the figure says how far the rate moved. An annuity gets the payment that ends the loan on the due date it ends on now, a fixed instalment keeps its payment and takes longer, equal principal pays the new interest on top. Each is read from the schedule the next payment is read from, so the last payment is what is left. Told for a loan with a Euribor reference rate that owes and has a rate, one point down and one up; a fall the rate has no room for is left out | `loanRateScenario` |
| The household's debts | Every saved loan, and every connected card and loan account that owes something: the list behind every debt total. No link between a saved loan and an account is stored, so none is left out | `householdDebts` |
| Credit use | Balance over limit: 1 is a full line. What is left to draw and what is over the limit come with it | `creditUse` |
| A connected account as a loan | A connected card, or an account with a credit limit, read as a loan so that its debt and its use come from the same functions. The bank reports credit in use as a balance below zero: what is owed is that balance with its sign turned, and nothing when the account is in credit. A bank that reported a card's debt as a positive number would read as no debt. The id is `account:<account id>` | `creditAccountLoan` |
| What a card cost | The bank's own charges on the card account in the complete months before a day, twelve at most. A charge worded as interest is interest, less the interest the bank took back and never below zero, and every other charge is a fee, and a late fee stays the late fee alert's. A month carried a balance when the bank charged interest in it. Nothing is scaled up for a card connected later | `cardCosts` |
| A payment's parts | Interest is one interval's interest on what was owed the day before, and amortisation is the rest, so the two add up to the payment. Amortisation is negative when the payment did not cover the interest. No view reads it in this release; a later release links a loan to its account | `splitLoanPayment` |

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
- Nothing is estimated. A figure that needs a field the loan lacks is empty and names the field: no rate, no
  interest; no payment, no payoff date.
- A saved loan cannot be tied to a connected account: no link is stored yet. Every saved loan and every connected
  card or loan account that owes is in the sums, so a debt the household saved and the bank also shows as an account
  is there twice. The Lainat report names each such set of saved loans once, with the accounts beside it (`maybeTwice`
  in `reports/loans.ts`): a connected card beside every saved card and credit line that owes, whatever their names,
  and a connected loan account beside every saved loan that is no card. It says that removing the saved loan takes the
  second one out. Saldot and the Säästövinkit loan area point to the report.
- A checking account below zero is no loan: its overdraft is in the accounts' total and not in the debt total. Beside
  a saved credit line that owes it may be that credit, and then the accounts less the debts hold it twice
  (`overdraftTwice` in `reports/loans.ts`). Lainat and Saldot say so where they show that figure, and that the right
  figure is then larger by the saved loan. They advise no step: removing the saved loan would take the debt out of the
  debt total, which holds it once.
- The debt total is one number. The Lainat report, the accounts less the debts and the Velat lines of the
  Säästövinkit loan area all read `householdDebts` (`packages/core/test/owners.test.ts` holds them together).
- The accounts less the debts ("Tilit miinus velat", `accountsLessDebt` of `balanceReport`) are the connected
  accounts' total less the saved loans, each at its balance on that day. Connected cards and loan accounts are in the
  accounts' total already. The figure holds no home, no investments and no other property, so it is not net worth and
  no page calls it that: the page says what is left out. It is empty for a month that ends before a saved loan's
  balance was told, and the same as the accounts' total without saved loans. Lainat and Saldot tell it for today.
- The Lainat report (`reports/loans.ts`) shows only when the household saved a loan. In the household view the
  accounts are the household's and the saved loans are the viewer's own, and the section says so. Its interest total
  leaves out the loans that owe and have no rate (`loansWithoutRate`, the count Säästövinkit reads too), and its
  payments a month leave out the loans without a payment and an interval and a loan whose balance is dated after
  today: each says how many. The line of a move of the reference rate names the payment only when the move has one,
  and a move with no figure has no line. A payment made less often than monthly is spread over its interval, and a payment
  without an interval is shown without one. The date a loan ends is "Viimeinen eräpäivä". What is not known reads
  "ei tiedossa", never zero.
- The Säästövinkit loan area reads a saved mortgage where there is one: its margin and reference rate answer for the
  `loan_rate` question, its balance is the loan's balance today, and paying it down early is counted at its own rate
  instead of a range of Euribor months. A saved mortgage with a fixed rate is asked nothing, as when the household
  answers that its rate is fixed. The mortgage is the saved one linked to the payment series, else the saved
  mortgage that owes most. Without a saved mortgage the area asks and counts as before.

## Säästövinkit

- A finding's euros are a year: the last 12 complete months, or 6 to 11 complete months scaled to a year with one
  step less certainty. Under six complete months there are no euros, under three only deadlines.
- Each finding has a low, a mid and a high figure with the assumption behind the range. The page shows the mid.
- A finding needs a mid of at least 120 € a year. A deadline has no euros.
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

## When it gets something wrong

- Change the category in the transaction list. *Vaihda kaikki saman kauppiaan tapahtumat* also creates a
  rule for old and new transactions.
- The category *Omat siirrot* removes a transaction from every total.
- Fix an account's type under *Asetukset > Tilit*. The type decides how transfers and savings are read.
- Set one category for a merchant under *Tapahtumat > Kauppiaat*. It applies to every row of that
  merchant, old and new, and removing the merchant's rule returns it to the built-in rules and the trade register.
- Write your own rules under the merchant table of *Tapahtumat > Kauppiaat*. A rule is plain words, such as a merchant's name, and
  matches whole words. Case does not matter, and ä and å match a, ö matches o.

A category you set by hand never changes by itself, not even after an update.
