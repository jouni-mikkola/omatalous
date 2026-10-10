# How transactions are counted

Every transaction lands in exactly one flow, so nothing is counted twice or left out.

| Flow | Means | Shown as |
|---|---|---|
| Kulutus (spending) | goods and services | Menot, categories, merchants |
| Velanhoito (debt) | loan payments, financing, interest, collection | part of Menot, own group in reports |
| Säästöt (savings) | savings accounts, funds, shares, crypto, gold, pension savings | savings rate, cash flow |
| Tulot (income) | salary, benefits, dividends, sales, refunds of costs | Tulot |
| Luotonnostot (borrowing) | credit drawn to an account, loan payouts | cash flow only, never income |
| Siirto (transfer) | money between your own connected accounts | not counted |

Savings rate = (income − spending − debt) / income.

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
| Category spike | A category's spending in the month is over 1.5 times the median of the previous six months and at least 50 € above it, over three or more purchases. Without its largest purchase it must still be above every one of those months, so a sofa or a car repair is not a spike. Mostly fixed bills and a month that was as high a year ago do not count. Before a year of history, December gifts and shopping and summer trips and outings do not count either |
| *Käytätkö vielä: …?* | An active subscription that the recurring detection marks for review: a service of 3–15 € a month (a gym up to 60 €) that has run for half a year. Shown when the period reaches today, two at most |
| *Pankkikuluja … vuodessa* | Bank fees and interest add up to over 100 € a year, judged over at least six months and 150 days of data. Reminder fees and late interest have their own alert |
| *… kertaa kuussa* | A merchant with at least eight small purchases a month (median under 10 €) over the last 90 days, with the yearly sum. Fixed costs, cash and payments to people are left out |

Alerts only read the data, so fixing a category or a transfer can remove one.

## Periods, fixed costs and insights

- *3 kk*, *6 kk* and *12 kk* are the last whole months. *Tämä kuu* runs to today and is compared with the
  same days of the previous month. *Tämä vuosi* runs to today; its savings rate counts its whole months,
  because the running month has its bills but often not yet its salary.
- *Kiinteät menot* are the active subscriptions and bills (rent, loans, insurance, day care, phone),
  per month over a year. A monthly fee with a year of history costs what its last twelve charges came
  to, so day care that is free in July counts 11 charges and electricity counts the winter too. The
  credit card bill is not a fixed cost; the month forecast still expects it.
- The month forecast is what has gone so far, the bills still due this month and the usual everyday
  spending for the days left (the median day of the last six whole months). On two test households its
  average error over their past months was 8 % on the 5th of the month and 4 % on the 20th.
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
- *Tulevat laskut* lists the bills that do not come every month (every second month, quarterly, half
  yearly, yearly) due in the next three months, from the recurring detection. Pet food, shops and
  clinics are purchases and are not listed. It is always about today.
- *Kiinteät ja muuttuvat* starts with the fixed costs as a share of the average income of the last six
  whole months (three at least). With a savings account balance from the bank it adds how many months of
  fixed costs the savings cover, against a buffer of three months. A CSV import has no balance, so it
  says nothing about the buffer.

## When it gets something wrong

- Change the category in the transaction list. *Vaihda kaikki saman kauppiaan tapahtumat* also creates a
  rule for old and new transactions.
- The category *Omat siirrot* removes a transaction from every total.
- Fix an account's type under *Asetukset > Tilit*. The type decides how transfers and savings are read.
- Set one category for a merchant under *Kategoriat > Kauppiaat*. It applies to every row of that
  merchant, old and new, and removing the merchant's rule returns it to the built-in rules and the trade register.
- Write your own rules on the *Säännöt* page. A rule is plain words, such as a merchant's name, and
  matches whole words. Case does not matter, and ä and å match a, ö matches o.

A category you set by hand never changes by itself, not even after an update.
