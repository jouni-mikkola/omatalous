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
| Refund from a shop | spending goes down in the category of the purchase when the shop was paid in the 120 days before and the refund is not larger than what is left of those payments; otherwise it is income ("Hyvitykset") | a refund cancels a purchase, see *Money that comes back* |
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
| A bill paid from another account, or under a payee name typed by hand | the series' bill of that date is paid: it is no row of what is due, and the year of rare bills counts it as paid in its month. The paying row keeps its payee, category and account | the same payee and about the bill's sum, or the bill's payment reference, or the creditor's IBAN that the series' earlier rows carry; never the sum alone. See *Bills paid another way* |
| Money between members in the *Koko talous* view | transfer | it stays in the household. In a member's own view a movement to or from an account the member has no part of is money between people, see *Joint accounts* |
| Joint account connected by both | one copy in the *Koko talous* view, the viewer's own, whole. In a member's own view it is counted at the member's part | the copies are the same real account when the bank gives them one identity (its own hash, else the IBAN). See *Joint accounts* |

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
- A refund after 120 days and one larger than the purchase stay income, and one to another account is not paired
  here. A shop gets 120 days because that is how long a card dispute runs, and a cancelled trip or a complaint can
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
- The block *Erääntyvät maksut* on Yhteenveto counts to the next payday (*The days to the payday* below). The list of
  the same name on Laskut keeps its 30 days: it lists the subscriptions and bills of the next 30 days from the same
  series as the block, whatever the block's window is and whichever account pays them. Its groups are what the accounts
  pay to the payday, what they pay after it, and last what a credit card is charged (*Kortilta veloitettavat*,
  `onCard`), so the first group's sum is the block's figure without a card's bill and an own transfer. It has no pay,
  no card bill and no transfer. A bill of a series is no row once it is paid: by the series' own row, or by a row the
  rule for a bill paid another way takes (`recurring-settled.ts`, *Bills paid another way*), except while that row is
  pending on a counted account: then the bill is listed, marked *varaus*, as in the block.
- Insights say what changed in the period. A month is compared with its usual level (the median of the
  six months before) and shown only when it is outside all of them. A longer period is compared with the
  previous one. A running month has none. Debt service is mentioned when it takes over 35 % of income.

## The first page

Yhteenveto opens with the card *Varallisuus*, then the blocks *Luokittelemattomat*, *Erääntyvät maksut* to the payday,
*Asuminen*, *Tulot ja menot* and last *Ilmoitukset*. The figures of *Varallisuus* and of the running month's spending are core's and the page shows them
as given.

**Luokittelemattomat** is `buildQuestions` (`analysis/questions.ts`): of the 365 days up to the period's end it tells how
much of the money is classified, and the five answers that would mend it most. Classified is money that is not spending
the default left in Muut menot (by what the purchase cost in the end), not income the default left in Muut tulot, and not a
card bill (purchases the app cannot see); a transfer is no money, and a refund lowers the spending it took back. The share is
`1 - unknown / (spending + income)` and the page rounds it down to a whole percent. An answer is a payee without a category
(a category for it, or *Ohita*, which keeps its money among the unknown) or a monthly payment that looks like a loan (the
proposals of Asetukset > Lainat). The block is drawn when something is asked or under 95 % is classified.

**Varallisuus** is `buildHoldings` in `holdings.ts`, the answer Saldot reads too. A group with nothing in it is left out. In a member's own view a joint account, a card
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
  is above zero, and *Käytettävissä* is the limit less what is used, 0 over the limit (`freeCents`). A card over its limit
  shows *Luottoraja ylitetty* and what is owed above it (`overCents`) in place of *Käytettävissä*. A card with no limit shows
  what is used alone. The last four digits of the number follow a card's name only when another card has the same name; the face shows them
  for every card that has a number.
  With two cards or more the last row is *Luottokortit yhteensä*, `cardsCents`: the cards' known use added together.
- **Lainat.** Every debt of `householdDebts` that is no connected card's: a saved loan, a loan account, and a saved loan
  linked to its account once. *Lainaa jäljellä* is what is left on the day (`leftCents`), and a loan whose balance is not
  known shows a dash and is left out of the debt total. *Kuukausierä* is the next payment spread over a month, and only a
  loan that has one shows it. The last row is *Lainat yhteensä*, `loansCents`: the loans' known balances added together.
- **The sums of the groups and of the debts.** A group's sum comes from core (`accountsCents`, `cardsCents`, `loansCents`:
  each null when no figure is known, never 0), and the page adds nothing up. When a card has something used and there are
  loans, a row under all three groups gives `debtCents`: *Velat yhteensä*, the one debt total of `householdDebts`, in which
  the cards' use and the loans' balance add up to the cent.

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

The block *Erääntyvät maksut* on Yhteenveto answers one question: does the account cover what is due before the pay
comes. `cashAhead` in `analysis/ahead.ts` owns its figures, and the block (`components/next-days.ts`) only words them.

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
- **Which accounts it counts** (`countedAccounts` in `analysis/ahead-moves.ts`, `counts` on the balance, said under *Saldo*). *all*:
  every checking account in view, which is Koko talous and an own view with no joint account. *own*: the checking
  accounts the member uses alone, while a joint account in view is left out. *part*: no checking account is the
  member's alone, so the joint ones, at the member's part. The line under *Saldo* says which when it is not *all*. The
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
  (`totals.dueCents`: bills, typed bills, card bills and own transfers) and the balance less them (`freeCents`). No
  day's balance is modelled and pay in the window is in none of those three. The figures need the balance of every counted
  account. `shortOn` is the day of the first payment that the balance and the pay dated before that day (as much as it
  is at least: `floorCents` of its estimate, 0 without one) do not cover, and `shortCents` the most the account lacks at
  a payment. The usual spending of a day (`everydayPerDayCents`) is the
  median of the last 13 whole weeks before the running month, without fixed costs, divided by seven, and 0 under
  eight whole weeks; it is in the answer, on no page and taken off no figure.
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
  it as a series. A savings plan to an account that is not connected is no transfer row and is counted once, as the
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
- *Harvinaiset laskut* on Laskut sums the bills that do not come every month (every second month,
  quarterly, half yearly, yearly) for each of the next twelve months, from the recurring detection. It
  shows the monthly figure to set aside at the right of its heading and a table with a row for each month
  that has a bill due: the due month, the payees and the sum, and the day a paid bill was paid. A bill paid another
  way (*Bills paid another way*) counts as paid in the month it fell due, at the series' usual sum, so the year's
  figure is the same before and after the paying row arrives. Pet food,
  shops and clinics are purchases and are not listed. It is always about today.
- *Kiinteät ja muuttuvat* has one column of fixed costs, the charges of subscriptions and bills with
  their loan instalments, and shows debt service outside them apart. The columns add up to the
  spending of the period. It starts with two figures, the fixed costs a month and their share of *Tavalliset tulot*,
  the share a dash where the income or the costs are too small to tell. It has no chart and no sentence.
- *Saldot* draws the total of the connected accounts as an estimate, each counted back from the day the bank
  gave its balance (that day in the app's time zone).

## Themes

A theme is a main class of spending, one level above the categories: *Asuminen*, *Ruoka*, *Auto* and twelve more
(`THEMES` in `themes.ts`). Every row that counts in spending has one theme and one line in it (`themeOf`), so the
themes of a period add up to its spending. A line is a category under its own label: *Ruoka* has *Ruokakauppa*,
*Ravintolat ja kahvilat*, *Ruoan kotiinkuljetus* and *Alko*.

- **Rows pulled from other categories.** One theme takes rows out of their categories by their words. *Auto* has the
  car's insurance, which is a row of *Vakuutukset*, the vehicle tax, a row of *Verot, maksut ja sakot*, the car's
  finance, a row of *Kulutusluotot*, and a lease whatever its category. Its lines say what a car row was for: fuel,
  charging, parking, service, inspection, insurance, tax, finance, a lease and the rest. Home insurance, property tax
  and a pet insurer's premium are not told apart yet and stay in the theme of their category.
- **A household without a car has no *Auto*.** Nobody is asked how many cars there are, so the fuel stands in for the
  answer: *Auto* exists when the months looked at hold six purchases of fuel or charging. Without it the car's own
  categories are lines of *Liikkuminen*, and the insurance, the tax and the finance stay where their category is.
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
- **A card account.** Where the bank gives a card account (the type code `CARD`, or a masked card number, in
  `accountType`; the link log's `cash_account_type` shows it), its rows are the card's purchases, and the first known
  day of the account is the day purchases are known from (`purchasesFrom`). An account that is no card account gives
  none: a bill paid from a deposit account is one row whatever was bought.
- **The longest history** is asked for by the fetch a consent the user has just given sets off, once for each account
  of the new consent, from the history limit, and recorded (`source` `longest`; the record only moves earlier). A
  background fetch never asks for it: a bank limits the calls a day.

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
| The household's debts | Every saved loan the view holds, and every connected card and loan account that owes something: the list behind every debt total. A saved loan the household linked to its account counts once, as one debt: with the bank's balance and the saved loan's rate and payments while the account's balance is at or below zero and not older than the balance typed for the loan, and as typed otherwise | `householdDebts` |
| Credit use | Balance over limit: 1 is a full line. What is left to draw and what is over the limit come with it | `creditUse` |
| A connected account as a loan | A connected card, an account with a credit limit, or an account of type loan, read as a loan so that its debt and its use come from the same functions. Credit in use is a balance below zero: what is owed is that balance with its sign turned, and nothing when the account is in credit. A bank tells what is owed on a loan account with either sign, so the sync stores a loan account's plus as a minus (`storedBalanceCents`) and an update mends the balances stored before; a card's plus is money the bank owes the holder and stays. A loan account's kind comes from its name (home loan, student loan, car loan, else other loan), never card or credit line, and it has no rate, payment or plan until a saved loan is linked to it. The id is `account:<account id>` | `creditAccountLoan` |
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
- A loan can carry the day its rate is reviewed (*Koron tarkistuspäivä* in the loan's form, `Loan.rateReviewDate`). The
  form shows it unless the reference rate is fixed, never requires it and keeps a day that has passed. No figure reads
  it yet.
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
- The debt total is one number. The Lainat report, the first page's *Velat yhteensä* (*Lainat yhteensä*, the loans' balances added, is the same figure when no card owes anything), the accounts less the debts and
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
  never zero; a saved loan of the viewer's own with a dash in it has the link *Täydennä* to *Asetukset* > *Lainat*, and a loan
  another member typed in has none. A connected credit card is a row of *Käytetty luotto* and, when the account has a limit
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
- The car's running cost holds leasing, and a car bought is shown apart. *Muut havainnot* stand on the same complete
  months as the findings. The answer counts the checks of the areas: all of them, those waiting for a number, a fact or
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
  tiedoista* takes what was said back, and the bank's holders decide again. The page can propose weights from what each
  user paid into the account in the last six complete months (`suggestWeights`), and stores them only when the member
  takes them.
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
- The balance and the credit limit of a joint account or a card are the member's part, so *Yhteensä* of Varallisuus and
  a card's used and free credit follow.
- A view settles a bill only by the rows it holds: a bill another member paid from an account the viewer does not see
  stays due in the own view and is paid in *Koko talous*. Sums are compared as the bank booked them (`billCents`), so
  a bill the member's part of a joint account paid is settled by the bank's whole sum of the row.
- Money a user pays into a joint account is a transfer: it pays for that user's part of what the account pays. Another
  movement to or from an account of the household that the member has no part of is money between people (*Maksut
  henkilöille*, *Maksut henkilöiltä*). A category set by hand is never changed, and two rows of one member that the
  member's own categorisation left unpaired are never paired here.
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
- Write your own rules under the merchant table of *Tapahtumat > Kauppiaat*. A rule is plain words, such as a merchant's name, and
  matches whole words. Case does not matter, and ä and å match a, ö matches o.

A category you set by hand never changes by itself, not even after an update.

Known limits of the joint account:

- The sums above the list on Tapahtumat go by the mark stored on a row. In Koko talous a payment between members, which
  the first page counts as a transfer, can be in them: a partner's payment into a joint account is money in there.
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
