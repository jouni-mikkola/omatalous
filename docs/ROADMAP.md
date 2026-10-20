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

Where the app should be: every figure is the sum of its rows and the same everywhere; every balance the bank reports
is matched to the rows; a new household gets from install to its own year of figures within an hour; the app reaches
you outside the browser when something needs you; the front page tells in ten seconds the money until payday, the
pace of spending and one thing to do.

### 0.70.0: more banks
- Classification tested on households of OP and S-Pankki as well as Nordea.
- Renewing every bank consent in one guided round.
- A monthly spending goal on Yhteenveto.
- An installable app that opens Yhteenveto without a network.

### Later
- Asetukset in tabs, the joint account ledger in a view of its own.
- Notices outside the browser, off by default: ntfy, a webhook or e-mail, for a consent about to end and for disk,
  backup and update problems.
- A backup to another machine as the default, encrypted, the app secret included.
- A second sign-in factor required for the admin when the address is public.
- Fewer overlapping reports, insights and savings tips, decided by what households actually open.
- English beside Finnish.
- Going far past a bank's own page (the coming months as a simulation, net worth over the years, your own price
  change against the consumer price index, the tax year) once the figures above hold.

## Done
- 0.69.0: Tarkistettavat asks every open question one at a time; Yhteenveto compares the month with the usual one; the source is public under AGPL-3.0.
- 0.66.0: the front page and charts: money until payday, the pace of spending and one thing to do at the top of Yhteenveto.
- 0.65.0: figures right: a row sent again is stored once, and one figure per concept on every page.
- 0.64.0: every payee in Tulot ja menot opens its transactions; the year comparison judges each month on its own.
- 0.63.0: Tulot ja menot opens row by row.
- 0.62.0: one figure, one value: savings rate, debt share and credit drawn read the same everywhere.
- 0.61.0: contracts told by their start and end in Laskut.
- 0.60.0: payments filed by what the payee does; card bills of one issuer merged.
- 0.59.0: the waterfall and its table agree to the cent.
- 0.58.0: Yhteenveto shows the month as a waterfall; a figure opens its own rows.
- 0.57.0 and 0.55.0: the rows behind each figure, one click away.
- 0.56.0: settling up between partners on joint accounts and shared cards.
- 0.54.0: two-step sign-in with an authenticator app.
- 0.53.0: Täsmää pankin saldoon: the bank's booked balances matched to the rows.
- 0.52.0: money from a steady payer gets its meaning from one answer; one definition of earned income.
- 0.51.0: the bank connection set up and kept from Asetukset alone.
- 0.50.0: a card bill's purchases filled in by hand.
- 0.49.0 and 0.48.0: all your data out in one file and back in.
- 0.47.0 and 0.45.0: rows and balances in other currencies kept apart from euro figures.
- 0.46.0: balance history kept; an update tells its steps.
- 0.44.0: a bill paid another way counts as paid.

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
- Opening data automatically after a period of inactivity.
- A native mobile app.
