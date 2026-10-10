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
| Rent received from a tenant | income ("Muut tulot") | |
| Refund from a shop | spending goes down in the same category | a refund cancels a purchase |
| MobilePay to or from a person | spending / income ("Maksut henkilöille", "Maksut henkilöiltä") | names like Elisa or Helen are people here, not companies |
| MobilePay to a business (name ends or starts with Oy, Ky, ry and the like) | spending in the business's category | a company form in the payee name rules out a person |
| Tori.fi, Vinted, Huuto.net | income ("Myyntitulot") | |
| Cash withdrawal | spending ("Käteisnostot") | |
| Bank fees | spending ("Pankkikulut") | |
| Pending card payment | counted, replaced by the booked row on the next fetch | your own category choice moves with it |
| Money between members in the *Koko talous* view | transfer | it stays in the household |
| Joint account connected by both | one copy in the *Koko talous* view | matched by IBAN |

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
