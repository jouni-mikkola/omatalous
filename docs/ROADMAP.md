# Roadmap

Omatalous is a self-hosted household finance app for Finland. This page says where it is going. Releases are
small and frequent; the order below can change, and nothing here is a promise of a date.

## Direction
1. **A true picture first.** The app says what it cannot see (card purchases, rows in other currencies, days
   before your bank history starts) and keeps what it can only learn on the day, such as the balance your bank
   reports.
2. **Exact across the household.** Who paid on a joint account, fair shares, and how to settle up between
   partners, asking you only where the bank rows cannot tell.
3. **Figures that prove themselves.** Every figure opens the rows behind it, and balances your bank told are
   matched against the rows.
4. **Far past a bank's own page.** The coming months as a simulation with a range, contracts, net worth over
   the years, your own price change against the consumer price index, a tax-year sheet, a handover sheet, and
   alerts through channels you run yourself.
5. **Local.** Everything runs on your own machine. The only outside parties are the bank connection, the return
   page after the bank login, and services you turn on yourself. English will come beside Finnish.

## The bank connection (Enable Banking)
- The app already makes its own keys, keeps the application id in Asetukset, lists banks live, runs the bank
  login, consent and fetch, and keeps within the banks' daily fetch limits.
- Some steps stay outside the app because Enable Banking offers no way to do them from it: signing in at
  enablebanking.com, registering your own application with the certificate the app made, and linking each
  account and card in their control panel. Asetukset > Pankkiyhteydet will walk you through each step and
  check the result.
- After the bank login, a fixed https page forwards your browser back to your own install. An install with its
  own public https name can return there directly; a private or home-network https name only once Enable
  Banking confirms it accepts such an address.
- If a bank or a consent fails, you will be able to read files instead: card statements first, later bank
  statement files (CSV, camt.053), always read in your browser.
- We follow the coming EU payment rules (PSD3 and the Payment Services Regulation) and the financial data
  access proposal, and adapt when they apply.

## Coming releases

### 0.44.0: bills paid another way, and fixes
- A bill paid from another account or under another name counts as paid in every view.
- Small fixes in the loan pages and in household view.

### 0.45.0: card bills labelled
- A card bill whose purchases the bank does not show says so on its row.
- Behind the scenes, the app now reads the type and day of the balance your bank reports.

### 0.46.0: balance history starts, and the update tells its steps
- From this release the balance your bank reports is kept each day, with its type and the day it refers to.
  Later releases use it to prove the figures.
- An update shows each step and how long it took.

### 0.47.0: rows in other currencies
- A row in another currency is kept and shown with its currency instead of being left out.

### 0.48.0: your data out and back in
- One file with everything you have told the app and the rows, and an import that first shows what it would change.

### 0.49.0: from which day the data is known
- Figures say from which day card purchases and each account's history are known.

### 0.50.0: card statements
- Open a card statement in your browser, check the purchases against the bill and keep the ones you accept.
  The file never leaves the browser; only accepted rows are saved, and any difference stays visible.

### 0.51.0: the bank connection wholly in Asetukset
- Step-by-step setup with checks, a test of the return address, and per bank: consent length, history
  reached, card support. A renewal prompt when a consent ends.

### 0.52.0: money from people
- One question per steady payer ("Mitä nämä ovat?"): a share of shared costs, a sale, own money, a gift,
  with a proposed answer and at most a few questions a visit. The answer applies to all past and future rows
  of that payer, so income means earned money.

### Then, in this order
- **Settling up between partners:** who paid over their share on joint accounts; an agreement per account
  (equal, a share, by income, or a fixed sum), dated so a change does not rewrite the past; refunds and shared
  costs paid back netted; one sum to settle.
- **Täsmää pankin saldoon:** per account, the bank's balance matched to the rows, or the difference and the
  days it lies in, or a plain reason why it cannot be checked.
- **Second sign-in factor** (one-time codes).
- **Miksi?** Every figure opens its rows and the rule that placed each one.
- **A front page as a cockpit:** the month from opening to closing balance, settling up, checks, open
  questions; every chart also readable as a table; tested at phone widths.
- **English:** one language module for the whole app, then English in Asetukset.
- **Installable:** install to the home screen with an offline read view.
- **Signed parts list:** a software bill of materials with every release, checked by the updater.
- **https at home and a restore test:** an https address for the home install and an automatic restore test.
- **Passkeys** on the https address.

### Further on
- The coming months day by day, with a range and "what if" switches (a rate rise, a bill moved, a purchase).
- Bills read from the bank barcode or its digits, expected before they are paid.
- Contracts with their price history and notice dates; a price rise said on the day it appears.
- Net worth over the years, with values you add (home, funds, pension), assets and debts shown apart.
- Your own price change against the consumer price index of Statistics Finland, fetched only if you turn it on.
- The tax year: lists of candidate rows with sums, each rule checked against vero.fi; nothing is filed.
- A printable handover sheet for the day someone else must take over.
- Alerts through Home Assistant, a self-hosted ntfy or your own e-mail server; off by default.
- Optional local categorising of rows the rules cannot place, on your machine only.
- A read-only interface for local AI assistants, off by default.
- Ready images for a Raspberry Pi and a NAS.
- Bank statement files when the bank connection does not cover an account or a period.
- Last, only if wanted: a local, opt-in way to share anonymised data that you send yourself.

## Version 1.0
1.0 comes when these checks pass, not on a date:
- A new household gets a well-classified picture in one evening, measured by a scripted test.
- Bank balances match the rows in the test data, and the check fails if nothing matches.
- An update from the previous release stays within its time budget and tells each step.
- An upgrade works from every supported version.
- A restore on a fresh machine, bank connection included, passes an automated drill.
- Export and import give back the same figures.
- Sign-in has a second factor and passkeys.
- A security audit has no serious finding open.
- Tests cover a second household at a second bank.
- No serious accessibility finding at phone and desktop widths.
- The app runs in English as well as Finnish.
- Performance budgets hold; no row is dropped without being shown.

## Not planned
- Payments from the app, credit scoring, investment advice, telemetry.
- Asking the home router for addresses.
- Free-text questions to the app.
- A cloud language model.
- Interest rate data bundled in the app.
- Reading shops' loyalty data by scraping.
- Opening data automatically after a period of inactivity.
- A native mobile app.
