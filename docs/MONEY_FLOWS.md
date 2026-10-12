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

A figure has one definition, in `packages/core`, and the first page, the reports and Laskut all use it.

| Word | Means | In core |
|---|---|---|
| *Valmis kuukausi* | A month that has ended and that the history covers from the 1st. The running month and a first, partly fetched month are not complete | `isCompleteMonth` in `analysis/usual.ts` |
| *Tavallisesti* | The median of the last six complete months before the month in question, in whole cents. With fewer than three complete months there is no usual level and nothing is compared with it. A month's usual spending is the median of those months' totals, on the same days for a running month: *Menojen muutos* and the buffer report say this one figure | `usualCents`, `completeMonthsBefore`, `usualSpending`, `usualSpendingOver` in `analysis/usual.ts` |
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

Monthly averages divide by complete months only, so a running month never pulls an average down. A category or pivot
average without one complete month is empty. A year comparison needs three whole months in both years. Money saved to an
own account or fund that is not connected (`own_unconnected` in Tietojen laatu) counts as saved, and the data quality card
names the sum and the largest payees, so a missing connection shows.

Tapahtumat's *maksettu* and *saatu* leave own transfers out, and so do a merchant summary's sums and its category. The
row count still includes them, and the page says the transfers are not in the sums.

## Yli jäi and borrowed money

*Yli jäi* is what a period left on the accounts: income + credit drawn − spending − debt service − saved (ADR 0014).
`totalsOf` holds the sum, and the first page and the cash flow report read `leftCents` from it. The figure is the same
number the rows give with no flow in between: the sum of every row on an account that is not a loan, less the transfer
rows (a pair cancels itself, so this takes away the legs with no other half in the period), less the money moved into
savings accounts, which is *Säästöön*. A card account is in the sum, since a card purchase is spending on the day it is
made. `packages/core/test/totals.test.ts` holds this to the cent for the demo, the seeded households and random rows.

Credit drawn (*Luotonnostot*) is money on the account that is not income. It is in *Yli jäi* and in no income figure,
savings rate or margin (`netCents`).

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
| Card bill paid from the current account, card account connected | transfer, or a card bill (spending) for a payment from before the card's rows begin | the purchases count once: on the card account, or in the bill when no row holds them. See *Card bills* |
| Same, card account not connected | spending ("Luottokortin lasku") | otherwise the purchases would be missing |
| Bill of another card of the same issuer (Platinum while only Gold is connected), or of another issuer's Gold | spending | only the connected card's purchases are counted on its account |
| Bill for a card that is not connected (e.g. Amex) while another card is | spending | only the connected card's bill is a transfer |
| Payment to a card issuer such as Nordea Rahoitus or Bank Norwegian | card bill if the amount changes every month, debt ("Kulutusluotot") if the same amount comes again and again | an instalment repeats, a card bill follows the purchases. A text with a loan word (*osamaksu*, *laina*) stays a loan, a card word in the text makes it a card bill, and one payment reference is one contract (see *Card bills*) |
| Money into the card account ("Maksu, kiitos", prepaying) | transfer | money into a card is a payment, not income |
| Credit moved from a card to the current account | transfer if both are connected, otherwise borrowing | borrowed money is not income |
| Mortgage payment, or a loan payment text (*lainanmaksu*, *lyhennys*) to a bank that lends mortgages (Nordea, OP, Danske, S-Pankki, Aktia and others) | debt ("Asuntolaina") | other lenders' loans, such as a car or appliance instalment, are "Kulutusluotot" |
| Mortgage account connected | its own rows are not counted, and the payment from the current account stays debt | the loan account only mirrors the payment |
| A housing company's charge for its own loan (*rahoitusvastike*, *yhtiölaina*, or a loan named by its purpose such as *remonttilaina*) | spending (housing), or debt when the text says *lyhennys* or *lainaosuus* | the company owes the loan and the shareholder pays a charge, so it is never proposed as a loan to save |
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
| Transfer to a person's account with no payment reference | spending ("Maksut henkilöille") | a gift or a share, not a sole trader's invoice. Money in is not read this way. See *People* |
| Money from another holder of your account (a partner), also when the bank calls it an own transfer | income that is not earned ("Maksut henkilöiltä") | it is her money, not your pay and not your saving. See *People* |
| A limited company with a word of lending in its name that no list knows | paid: debt (finance, credit, loan, bank). Money in: borrowing, for finance, credit or loan only | a bank also pays pay and bonuses. See *Lenders* |
| Money out to the bank of a connected account, by its plain name | not debt by the name alone | a paper statement or a card bill paid by reference with sums that vary is no instalment: the same sum paid month after month under one reference is (see *Lenders*). The bank's finance company is a lender like any other |
| MobilePay to a business (name ends or starts with Oy, Ky, ry and the like) | spending in the business's category | a company form in the payee name rules out a person |
| Tori.fi, Vinted, Huuto.net | income ("Myyntitulot") | |
| Cash withdrawal | spending ("Käteisnostot") | |
| Bank fees | spending ("Pankkikulut") | |
| Pending card payment | counted, replaced by the booked row on the next fetch | your own category choice moves with it |
| Money between members in the *Koko talous* view | transfer | it stays in the household |
| Joint account connected by both | one copy in the *Koko talous* view | matched by IBAN |

## How a row is read

A row is read in this order. Each step decides only what the steps before it left open, and a category you set by hand
is never changed.

1. The merchant name is worked out from the bank's fields (*Merchant names*).
2. The category rules, where the first match wins, in this order: your own rules, money to and from people
   (*People*), the rules of purpose (pay, benefits, loans, card bills, savings, fees, taxes), the bank's own code of the
   row, a person by the bank's word or by a payment with no reference, lenders by the shape of their name and the bank's
   own rows (*Lenders*), and last shops and the generic rules. The card's merchant code and the trade register come
   after the rules (ARCHITECTURE.md, *Structure*).
3. A payment to a card issuer is a loan or a card bill (*Card bills*).
4. Money that comes back is matched to its payment (*Money that comes back*).
5. Transfers: pairs of rows, a card's payment channel, the issuer fallback (*Card bills*).
6. What the same merchant's other rows say: a payee that paid credit out is a lender (*Lenders*), and the register's
   industry gives the rest.

### Card bills

A card bill moves money from a current account to a credit card. The purchases are spending already, on the card
account, so the bill must not count again. Each run works this out from the rows alone and stores nothing.

- **The wording and the amount.** A payee named like a card issuer (Nordea Rahoitus, Bank Norwegian) is a loan payment.
  A card word in the text makes it a card bill at once. Of one issuer's payments on one account, a sum that comes three
  times or more is an instalment and stays a loan. The others are card bills when there are at least three of them and
  they change by more than a tenth from one payment to the next (the median change).
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
  the card's own rows began more than a billing month (`BILLING_MONTH_DAYS`) before it: the purchases it pays are on
  the card account. A payment within that time of the card's first row, or before it, is a card bill and counts as
  spending (*Luottokortin lasku*), since the purchases it pays are in no row. A channel that several cards share pays
  the card whose rows began last before the payment, so a new card's first bill is a card bill whatever the old card's
  rows hold. A bill that pairs is a transfer whenever it is paid, so the purchases of the first paired bill are counted
  nowhere.
- **The issuer fallback.** A payment still called a card bill, whose text names a connected card, is a transfer. The
  text names a card when it holds the issuer's word and the card's product: a Platinum bill while only Gold is connected
  stays spending. A name is weak evidence, since a finance company shares its bank's name, so it counts only when
  nothing better is known: the card has no channel yet, the payment is not to the account and reference that paid
  credit out to the household (a lender's contract, which a flexible credit repaid in varying sums is: *Lenders*), the
  row is no return and was not set by hand. A bill that names a connected card is that card's also when its issuer paid
  credit out: only the payments to the account and reference the credit came from are left as they were.
- **Your rules.** The channel decides every payment that could be a transfer leg, also one that a rule of yours put in
  a debt, savings or *Muut* category. A rule to a purchase category (*Koti*) and a category set by hand on a row stay.
- **Data quality.** The bills counted as spending show in Tietojen laatu (*Korttilaskuja … lasketaan menoiksi*), with a
  card connected too: the bills of the months before the card's rows, and those of a card that is not connected.

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
  co-holder's account.
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
(`followingNames` in `services/upgrade.ts`). A rule, a mark, a loan's series, an answer *Ei laina* and an Optimoi
decision follow an old name when every row of it gets one new name that no other old name gets. When old names merge,
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
- Reports use the same pairs. A purchase that was paid back leaves the lists of merchants,
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
| Category spike | A category that rose in the month against its usual level in the *Menojen muutos* report, by the report's gate or more and out of its own noise, with the report's amount and usual level (ADR 0013). Every category is read, also one the report's table folds into *Muut*. The month is the report's: the one the period ends in, so the running month's spike shows when Yhteenveto shows the running month, and last month's when it shows the month before. The rise in purchases that are no one-off and no bill or subscription of a month or longer must be at least 50 €, over half the usual level, from three or more purchases, most of the category's rise and above every usual month, so a sofa, a car repair, a new subscription or a bigger bill is not a spike. A running month is set against the same days of the usual months (*Tavallisesti tähän mennessä*). When the rows end before today, the alert names the day both figures are cut at (*10.10. mennessä*). A month that was as far above usual a year ago does not count. Before a year of history, December gifts and shopping and summer trips and outings do not count either. Uncategorised rows and loan payments never alert |
| A forgotten subscription, titled with the merchant and its cost (*Esimerkkipalvelu 12 €/kk, 144 € vuodessa*) | An active subscription that the recurring detection marks for review: a service of 3–15 € a month (a gym up to 60 €) that has run for half a year. The alert says how many months it was paid and asks with the buttons *Käytössä* and *Lopetettu*. Shown when the period reaches today, two at most |
| *Pankkikuluja … vuodessa* | Bank fees and interest add up to over 100 € a year, judged over at least six months and 150 days of data. Reminder fees and late interest have their own alert |
| *… kertaa kuussa* | A merchant with at least eight small purchases a month (median under 10 €) over the last 90 days, with the yearly sum. Fixed costs, cash and payments to people are left out |

Alerts only read the data, so fixing a category or a transfer can remove one.

## Periods, fixed costs and insights

- Yhteenveto offers two months and names them (*Lokakuu 2026*, *Syyskuu 2026*): the running month, which runs to
  today and is compared with the same days of the previous month, and the month before it, whole. *3 kk*, *6 kk* and
  *12 kk* on Raportit are the last whole months. *Tämä vuosi* on Raportit runs to today. Its savings rate counts its
  complete months, because the running month has its bills but often not yet its salary.
- *Menojen muutos* (on Yhteenveto, with the month before the running one chosen) sets the month against its usual
  total and splits the change into causes by category. A category's usual level is its own median with its one-offs struck. Medians do not add up,
  and a level leaves its one-offs out, so the categories' levels add up to more or less than the usual month. The
  difference is in *Muut* as *Kuukausien vaihtelu*, which is no cause and can make the usual of *Muut* negative.
- The card of the days to the payday on Yhteenveto counts to the next payday (*The days to the payday* below). *Tulossa* on Laskut keeps
  its 30 days: it lists the subscriptions and bills of the next 30 days from the same rows as the card, whatever the
  card's window is.
- Insights say what changed in the period. A month is compared with its usual level (the median of the
  six months before) and shown only when it is outside all of them. A longer period is compared with the
  previous one. A running month has none. Debt service is mentioned when it takes over 35 % of income.

## The first page

Yhteenveto opens with the card *Varallisuus*, then *Menot* when the running month is shown, then the card of the days
to the payday. The figures on the first two are core's and the page shows them as given.

**Varallisuus** is `buildHoldings` in `holdings.ts`, the answer Saldot reads too. A group with nothing in it is left out.

- **Tilit.** Checking, savings and other accounts, each with its balance from the day walk. *Yhteensä* is
  `accountsCents`: the known balances of the accounts added together. An account the bank gave no balance is left out of
  the sum and counted in the small line under it (*Ilman 2 tilin saldoa*), and with no known balance at all the total is
  empty, never 0. With more than four accounts, those with less than a euro in them, either side of zero, fold into
  *Muut tilit* and stay in the total.
- **Luottokortit.** Each connected credit card. *Käytetty luotto* is what is owed on it as `householdDebts` counts it
  (`usedCents`: 0 for a card in credit, *Ei tiedossa* when the bank gave no balance). *Luottoraja* is the limit the bank
  gave, when it is above zero, and *Käytettävissä* is the limit less what is used, 0 over the limit (`freeCents`). A card
  over its limit shows *Luottoraja ylitetty* and what is owed above it (`overCents`) in place of *Käytettävissä*. A card
  with no limit shows what is used alone.
- **Lainat.** Every debt of `householdDebts` that is no connected card's: a saved loan, a loan account, and a saved loan
  linked to its account once. *Lainaa jäljellä* is what is left on the day (`leftCents`), and a loan whose balance is not
  known says so and is left out of the debt total. *Kuukausierä* is the next payment spread over a month, and only a
  loan that has one shows it.
- **The debt row.** Under the loans, when the household owes anything, stands `debtCents`: the one debt total of
  `householdDebts`, in which the cards' use and the loans' balance add up to the cent. It is called *Velat yhteensä*
  when a card has something used and *Lainat yhteensä* when the loans alone make it (`debtTotalName` in
  `components/holdings/holding-rows.ts`).

**Menot** is `monthPace` in `analysis/forecast.ts`. Spending is what the totals count, consumption and debt service.
Nothing is forecast: both months are sums of real rows. The card shows the running month only; the month before is told
by *Menojen muutos*.

- **The figure** is the month's spending so far, `currentTotal` of `monthPace`: the cumulative spending to today, 0
  before the 1st.
- **The line under it** (*Syyskuussa 12.9. mennessä* and a sum) is the month before by the same day of the month
  (`previous.toToday`), or by its last day when that month is shorter than today's day of the month. It is left out
  when the history has no row in the month before.
- **The chart** (*Menojen kertymä*) draws both months day by day, each the cumulative sum of its rows: the running month
  to today, the month before to its last day. The month before has no line when the history does not reach it, and with
  nothing spent yet the card says so in a line instead of a chart.

## The days to the payday

The card on Yhteenveto that counts the days to the payday answers one question: is there enough on the account until the pay comes. `cashAhead` in
`analysis/ahead.ts` owns its figures, and the card (`components/next-days.ts`) only words them.

- **The payday** is the next pay of the regular income with the largest usual amount. A monthly salary comes on its pay
  day as the income code finds it from the dates it was paid on (`payDayOf` and `nextPayDate` in `analysis/income.ts`,
  the rule the income report prints the next pay by): the usual day of the month, moved to the banking day before when
  it falls on a weekend or a bank holiday, or to the one after for a payer such as Kela. Other cadences, and a payer
  with no fixed day, follow the series' own dates. The window runs from today to the day before the payday.
- **Three states** (`reason`). *payday*: the window ends the day before the payday, and the card is titled with the day
  (*Palkkapäivä* and the day). When the payday is today or tomorrow the window is today alone, and today's balance is the
  last one before the pay. *none*: there is no regular income, or its next pay is more than 45 days away
  (`MAX_PAYDAY_DAYS`), so the window is the next 30 days (*Seuraavat 30 päivää*). *late*: that pay is more than five days
  late (`OVERDUE_DAYS`), so the window is 30 days and the card says since when the pay was expected.
- **What the window holds.** The subscriptions and bills that the history shows (also savings plans, which leave the
  checking account), the bills the household typed in while they are still to pay (one that the history shows as a
  series is left out, and so is one for which a row of about the same amount, within 5 %, was booked from 31 days
  before its date up to today: `expectedBillRows` in `analysis/forecast.ts`), and other pay that lands inside it. The
  payday itself is no row. With a checking balance, own and shared, and one complete month, it gives the balance at the
  end of each day. It starts from today's balance as Saldot has it (the bank's balance with
  the rows booked since), adds other pay, takes off the bills and takes off the usual everyday spending per day from
  tomorrow on (the median of the last six complete months, without fixed costs). Start balance plus pay less bills less
  everyday spending is the last day's balance, to the cent. The lowest day is named when it is below zero or below a
  day of everyday spending.
- **What it does not hold.** The bill of a connected card, which is a transfer: the card's purchases are in the
  everyday spending day by day instead, so the line does not drop on the day the bill is paid. The bill of a card that
  is not connected is a bill like any other when the history shows it as a series.

## Reports

- *Tulot ja menot* tells the margin and the savings rate from the months that have ended when the period
  holds the running month. The totals above them include it.
- The spending of a range has one owner, `totalsOf` in `analysis/flows.ts`: the expense of *Tulot ja menot*, every
  row's spending with the refunds taken off. Three readers show that total and nothing else. *Kategoriat* divides every
  share by `spendingBase` (`analysis/data-quality.ts`, the same sum over the range's rows), and so does the notice of
  uncategorised rows for the share of *Muut menot*. *Kuukausitaulukko* has the month totals and the total as sums of all
  its rows. `packages/core/test/reports-totals.test.ts` holds the three to the cent for the seeded households.
- A category whose refunds were greater than its spending in the range stays in *Kategoriat* and *Kuukausitaulukko* as a
  row with its minus, last in the order. Its share is negative, the shares add up to 100 %, and the page shows "–" for
  the share with a line under the table. The previous period is not cut at zero either, so *Muutos* adds up. The
  first page's own list of categories (*Kategoriat*) adds only categories above zero, so it can differ from the month's total by the
  refunds of such a category.
- *Luokittelematta* on Tapahtumat lists the 50 merchants with the most money out that nothing recognised. Its heading
  counts all of them and their money out, which the server adds up in SQL, so the list can be shorter than the count.
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
  spending of the period. It starts with the fixed costs as a share of *Tavalliset tulot*. With a balance on a savings or checking account it says how many
  months of usual spending, groceries included, that money covers against a buffer of three months, and names
  the gap below it. Under three complete months it gives the date the figure appears. Without a balance it says
  where to add one.
- *Saldot* draws the total of the connected accounts as an estimate, each counted back from the day the bank
  gave its balance (that day in the app's time zone).

## Loans

The bank connection shows payment accounts only, so a loan is typed in, pasted or read from a picture, and the household
confirms it. Its payments are still bank rows and stay in the debt flow: a known loan changes no flow. Each figure has
one definition, in `packages/core/src/loans.ts`, and the list of the household's debts behind every debt total is in
`packages/core/src/household-debts.ts`.

| Figure | Means | In core |
|---|---|---|
| Balance on a day | The stated balance moved forward from its date by the repayment plan, one payment at a time. A loan whose plan lacks a field keeps the stated balance and names the field. Before the balance date there is no figure | `loanBalanceOn` |
| Debt total | The sum of those balances. The loans left out or counted at their stated balance are listed with it | `debtTotalOn` |
| Interest over 12 months | The interest parts of the payments due in the 12 months after the day. A loan whose balance stays (no plan, or a bullet loan) owes its rate on that balance for the days before its last due date, and a whole year is balance × rate. Without a rate there is no figure, except that a loan that owes nothing costs nothing | `loanInterestNext12Months`, `debtInterestNext12Months` |
| Payoff date | The due date that brings the balance to zero, at the latest the last due date. None when a payment does not cover its interest or a field is missing | `loanPayoffDate` |
| Next payment | The next payment of the plan in full, with its interest and its amortisation. It is never more than what is owed with its interest: the last payment is what is left. A loan that owes nothing has none, and neither has a bullet loan. A payment typed for a loan without a whole plan is told as typed, at most what is owed (with one interval's interest when the rate and the interval are known), and has no parts | `loanNextPayment` |
| Payments a month | Each loan's next payment divided by its interval in months, to the nearest cent with a half cent up, added together. A loan that owes but has no payment with an interval is counted as missing. A bullet loan is counted apart: it pays interest and no instalment | `debtPaymentsPerMonth` |
| A move of the reference rate | The payment and the next 12 months' interest with the rate moved by a number of points. The rate falls no lower than the loan's margin, and to zero when no margin was told. The figure says how far the rate moved. An annuity gets the payment that ends the loan on the due date it ends on now, a fixed instalment keeps its payment and takes longer, equal principal pays the new interest on top. Each is read from the schedule the next payment is read from, so the last payment is what is left. Told for a loan with a Euribor reference rate that owes and has a rate, one point down and one up. A fall the rate has no room for is left out | `loanRateScenario` |
| The household's debts | Every saved loan, and every connected card and loan account that owes something: the list behind every debt total. A saved loan the household linked to its account counts once, as one debt: with the bank's balance and the saved loan's rate and payments while the account's balance is at or below zero and not older than the balance typed for the loan, and as typed otherwise | `householdDebts` |
| Credit use | Balance over limit: 1 is a full line. What is left to draw and what is over the limit come with it | `creditUse` |
| A connected account as a loan | A connected card, or an account with a credit limit, read as a loan so that its debt and its use come from the same functions. The bank reports credit in use as a balance below zero: what is owed is that balance with its sign turned, and nothing when the account is in credit. A bank that reported a card's debt as a positive number would read as no debt. The id is `account:<account id>` | `creditAccountLoan` |
| What a card cost | The bank's own charges on the card account in the complete months before a day, twelve at most. A charge worded as interest is interest, less the interest the bank took back and never below zero, and every other charge is a fee, and a late fee stays the late fee alert's. A month carried a balance when the bank charged interest in it. Nothing is scaled up for a card connected later | `cardCosts` |

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
  beside it (`maybeTwice` in `reports/loans.ts`): a connected card beside every saved card and credit line that owes,
  whatever their names, and a connected loan account beside every saved loan that is no card. It says that removing the
  saved loan takes the second one out, and beside each of the household's own accounts it links to the loan's form with
  that account chosen, which counts the pair once. A linked loan or its account is not named. Saldot and the
  Säästövinkit loan area point to the report.
- A checking account below zero is no loan: its overdraft is in the accounts' total and not in the debt total. Beside
  a saved credit line that owes it may be that credit, and then the accounts less the debts hold it twice
  (`overdraftTwice` in `reports/loans.ts`). Lainat and Saldot say so where they show that figure, and that the right
  figure is then larger by the saved loan. They advise no step: removing the saved loan would take the debt out of the
  debt total, which holds it once.
- The debt total is one number. The Lainat report, the first page's *Velat yhteensä* (*Lainat yhteensä* when no card owes anything), the accounts less the debts and
  the Velat lines of the Säästövinkit loan area all read `householdDebts` (`owners.test.ts` and
  `balances-holdings.test.ts` in `packages/core/test` hold them together).
- The accounts less the debts ("Tilit miinus velat", `accountsLessDebt` of `balanceReport`) are the connected
  accounts' total less the saved loans that are no linked account's debt, each at its balance on that day. Connected
  cards and loan accounts, a linked loan's among them, are in the accounts' total already. The figure holds no home, no investments and no other property, so it is not net worth and
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
  `loan_rate` question, its balance is the loan's balance today (the bank's balance when the mortgage is linked to its
  loan account), and paying it down early is counted at its own rate
  instead of a range of Euribor months. A saved mortgage with a fixed rate is asked nothing, as when the household
  answers that its rate is fixed. The mortgage is the saved one linked to the payment series, else the saved
  mortgage that owes most. Without a saved mortgage the area asks and counts a range of Euribor months.

## Säästövinkit

- A finding's euros are a year: the last 12 complete months, or 6 to 11 complete months scaled to a year with one
  step less certainty. Under six complete months there are no euros, under three only deadlines.
- Each finding has a low, a mid and a high figure with the assumption behind the range. The page shows the mid.
- A finding needs a mid of at least 120 € a year. A deadline has no euros.
- The car's running cost holds leasing, and a car bought is shown apart. *Muut havainnot* stand on the same complete
  months as the findings. A check with no rows to read is told "ei tietoja" and is not counted as checked.
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

- Change the category in the transaction list. *Käytä samaa kategoriaa kauppiaan muissa tapahtumissa* also creates a
  rule for old and new transactions.
- The category *Omat siirrot* removes a transaction from every total.
- Fix an account's type under *Asetukset > Tilit*. The type decides how transfers and savings are read.
- Set one category for a merchant under *Tapahtumat > Kauppiaat*. It applies to every row of that
  merchant, old and new, and removing the merchant's rule returns it to the built-in rules and the trade register.
- Write your own rules under the merchant table of *Tapahtumat > Kauppiaat*. A rule is plain words, such as a merchant's name, and
  matches whole words. Case does not matter, and ä and å match a, ö matches o.

A category you set by hand never changes by itself, not even after an update.
