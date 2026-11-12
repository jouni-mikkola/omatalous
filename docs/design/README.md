# Design: the simple omatalous

Direction, 12.11.2026 (the owner's decision): the 1.0.0 interface is the baseline. The header has the tabs Yhteenveto,
Laskut, Tapahtumat and Raportit, the page of an add-on module after them, Tarkistettavat as a link with its count at
the right, and Asetukset in the user menu. Where a section below says Nyt, Kuukausi, Tulossa or Lisää it describes the
plan this decision replaced; the sections are rewritten as their pages return to the 1.0.0 shape.

The app answers four questions a household asks of its money, one view each, and asks the household about what it cannot
settle itself. Everything else is deleted or sits in one Lisää list. Read with `docs/audit/simplify.md` (what is there
today, with screenshots in `docs/audit/shots/`) and `docs/research/peers.md` (Sure, Actual and the others). Every
deletion below is for the owner to confirm when its step moves into `docs/ROADMAP.md`.

Sure opens on eight dashboard sections or an AI chat ([pages_controller.rb](https://github.com/we-promise/sure/blob/0cb32845216cf087401c37e512a8b9cdaee3eb3e/app/controllers/pages_controller.rb)),
Actual on an envelope budget to fill each month ([docs](https://actualbudget.org/docs/budgeting/)). Omatalous opens on
one sum: what is left until payday after the bills due before it. No peer has payday or the household's usual built in.

## 1. Questions and views

Ranked by how often asked. Four tabs: Yhteenveto, Laskut, Tapahtumat, Raportit. Tarkistettavat is the header's link.

### 1.1 Yhteenveto: how much can we still spend before payday?
- Answer: one sum, "Palkkapäivään 25.11. jää 4 424 €", after the bills due before payday.
- Comparison: that sum per day left ("277 € päivässä, 16 päivää") against what everyday spending usually takes per day,
  and one line of pace: spent so far this month against the usual band to the same day (the chart of today's Kuukausi
  section, which `docs/audit/simplify.md` names as the good one).
- Action: the sum opens the balance and the bills behind it; the pace line opens this month's rows.
- Layout: the page of 1.0.0. The answer on the left with the sum row that makes it on the right (balance, payments
  before payday, what is left, to the cent). Under it Kuukausi on the left, Huomioitavaa and Suurimmat menot on the
  right, Varat ja velat across the page. A phone reads them in that order in one column.
  - Kuukausi: one sentence with the side of the usual the spending is on, the usual sum and its range, the pace chart
    of the same figures and the chart's latest days as a table. The month before is drawn only when the household
    has no usual level yet.
  - Huomioitavaa: the first three open questions of Tarkistettavat in the queue's order, each with its sum, and the
    count of all. It asks nothing itself and is not drawn when nothing is open.
  - Suurimmat menot: the five largest categories as bars on one scale, last month's sum to the same day as a mark on
    each bar and the difference in words. A bar opens the category's rows.
  - Varat ja velat: what is left after the debts, the accounts' balance, the debts, the buffer in months and the
    12-month average spending, the first two parts links to their rows. A loan with no saved balance takes the net
    figure away and is named with the way to save it.
- Not shown: account cards, card faces, credit arcs, goals.
```
 Palkkapäivään 25.11. jää   4 424 €          Käyttötilin saldo            7 198,65 €
 277 € päivässä, tavallisesti 65 €           Maksut ennen palkkapäivää   −2 774,52 €
                                             Jää                          4 424,13 €

 Kuukausi                                    Huomioitavaa
 Käytetty 2 018 €, 90 € yli tavallisen.      Laina  Rahoitus Oy      289,00 € kuussa
 ▁▂▃▅▆ ─ ─                                   Kaikki 9 tarkistettavaa
 12.   2 018,10 €   1 928,00 €
                                             Suurimmat menot
                                             Ruokakauppa                      612 €
                                             ████████|██  140 € enemmän kuin viime kuussa

 Varat ja velat
 Varat velkojen jälkeen   Tilien saldo   Velat   Puskuri   Menot keskimäärin, 12 kk
```

### 1.2 Kuukausi: where did the money go this month compared with usual?
- Answer: one ranked list of categories with this month's sum to date.
- Comparison: each row has the usual sum to the same day (`analysis/usual.ts`) as a tick on its bar and the gap in euros.
  The list is sorted by the gap, so the category that explains the month is first. One total row above it.
- Action: a row opens its rows; a month picker steps back. Income is one row at the bottom, not a page.
- Not shown: a pie or donut, a pivot, fixed against variable, the share of each flow, any figure without its usual.
```
 Marraskuu 1.–9.11.   Käytetty 2 018 €, tavallisesti 1 930 € (+88 €)
 Ruoka             612 €  ████████|██   +140 €
 Asuminen          890 €  █████████|     ±0 €
 Liikenne          118 €  ███  |         −52 €
 ...  Tulot 3 900 €, tavallisesti 3 900 €
```

### 1.3 Tulossa: what is coming?
- Answer: the list of bills and income from today to the payday after next, one row each, grouped by payday period.
- Comparison: each bill against its last amount ("+3 € viime kerrasta") and the period's sum against the money there.
- Action: a row opens its history; a missing bill is added by hand (`expected_bills`); a wrong one is marked not recurring.
- Not shown: a dot timeline, price-step charts, contract panels, a 12-month forecast with ranges.
```
 Ennen palkkapäivää 25.11.        laskut 2 774,52 €
 12.11.  Vuokra                   890,00 €
 15.11.  Sähkö                     64,20 €   +3 € viime kerrasta
 25.11.  Palkka                 3 900,00 €
 Seuraavalla jaksolla 26.11.–24.12.   laskut 2 810 €
```

### 1.4 Tarkistettavat: is anything wrong?
- Answer: the count of open items in the header, and the queue one item at a time (today's `pages/Review.tsx`).
- Comparison: each item names its evidence against what is usual: a price up from the last charge, a new recurring
  charge, a balance that differs from its rows, a bank consent ending, a bill that did not come, a row nobody can sort.
- Action: one answer per item (yes, no, a category, reconnect). Answered items leave the queue.
- Not shown: tips, card grids, "you could save" estimates, anything already answered, any item without a sum.
```
 Tarkistettavat 3 / 8
 Sähkö nousi 51,10 €:sta 64,20 €:oon (+26 %). Hyväksytkö uuden hinnan?
 [Kyllä] [Ei, selvitän]                       Ohita
```

### 1.5 Rows, Lisää and Asetukset
- Rows: one list (`components/table/Table.tsx`), opened by any figure with its filter in the address, with search.
  Each row is date, name, category as text and amount. Group by merchant is a toolbar choice, not a view.
- Raportit has the list of its reports on every report page, as in 1.0.0: Kuukausi (what the tab opens), Rahankäyttö,
  Verovuosi, Velat, Tilit ja saldot, and Yhteiset menot only with a shared account. A report with nothing to show is not listed.
- Asetukset has three tabs: Pankit ja tilit, Kotitalous (members, sharing, rules, payday), Palvelin (admin only).

## 2. What goes

Deleted with its code, styles, tests and texts unless it says "moves".

| What | Code | Why, or where it moves |
|---|---|---|
| Säästövinkit page | `pages/Optimise.tsx`, `components/optimise/`, core `optimise/`, `routes` and `db/finance/optimise.ts` readers | Answers no question; price and new-charge findings move to Tarkistettavat |
| Huomioitavaa on Yhteenveto | `components/home/Notable.tsx`, core `analysis/insights/` | Moves to Tarkistettavat as items, once |
| Right column of Yhteenveto | `components/holdings/` | Repeats the headline; balances move to Lisää > Tilit ja saldot |
| Last-days table, direction, reliability | `components/home/PaceTable.tsx`, `Direction.tsx`, `Reliability.tsx` | The pace line already answers |
| Spending and category goals | `components/home/SpendingGoal.tsx`, `CategoryGoals.tsx`, `pages/settings/SpendingGoalCard.tsx`, report `categoryGoals` | Usual is the comparison; goals show no figure today |
| Tapahtumat tiles and weekly chart | `pages/Transactions.tsx`, `pages/transactions/` | Whole-history totals compare with nothing |
| Row marks | `components/MerchantAvatar.tsx`, `BankLogo.tsx` in rows, category chip icons, amount bars | Four marks repeat the text |
| Merchants view | `pages/Merchants.tsx` | Moves to the rows list as group by merchant |
| Rules page | `pages/Rules.tsx` | Moves to Asetukset > Kotitalous |
| Laskut timeline and sums | `components/bills/Timeline.tsx`, `PriceSteps.tsx`, `ContractPanel.tsx` | Tulossa keeps the list only |
| Raportit menu and 7 pages | `pages/Reports.tsx`, `pages/reports/pages/*`, `pages/reports/Verdict.tsx`, core `reports/conclusions/` | Kuukausi and Lisää replace them |
| Report sections that go | `pages/reports/sections/` Pivot, FixedVariable, Drift, SpendingChange, SpendingTable, Food, Buffer, Cashflow, LongForecast, Income, FixedCosts, PriceChange, DataQuality, CategoryGoals | Folded into Kuukausi (Income is its income row), Tulossa or Tarkistettavat, or answer nothing. ThisMonth, Balances, Loans, Borrowed, Settlement, TaxYear and YearOverYear stay, in Kuukausi or Lisää |
| Core reports that go | `packages/core/src/reports/index.ts` ids `pivot`, `fixedVariable`, `drift`, `spendingChange`, `spendingTable`, `food`, `buffer`, `cashflow`, `longForecast`, `priceChange`, `dataQuality`, `categoryGoals`, `conclusions`, `summary`, `fixedCosts` | 24 ids become 9: `thisMonth`, `categories`, `upcoming`, `income`, `yearOverYear`, `balances`, `loans`, `taxYear`, and `housing`, which feeds a Tarkistettavat question |
| Unopened views counter | `pages/settings/UnopenedViews.tsx`, `services/view-opens.ts` | This rework is the deletion it waited for |
| Remote access in 9 files | `pages/settings/RemoteAccess*.tsx`, `remote-access-*.ts` | One form |
| Six settings tabs | `pages/settings/*Page.tsx` | Three tabs; Data and Security fold into Palvelin and Kotitalous |
| Loan read from a picture or PDF | core `loan-intake/`, `pages/settings/LoanIntake.tsx`, tesseract.js, pdfjs-dist | A loan is a short form |

## 3. Visual system

- Type: the scale of 1.0.0, one family; 32 px the answer, 20 px a middle figure, 16 px a section title, 14 px body and
  rows, 12 px labels; weights 400 and 600.
- Spacing: a 4 px base, steps 4, 8, 12, 16, 20, 24, 32, 48. A row is 32 px high, 44 px where it is a touch target.
- Colour: neutrals for text and lines (ink, two greys, one rule colour, white page), one accent for links, the current
  bar and the focus ring. Red only for a problem: an overdrawn sum, a missed bill, a failing bank. Over usual is not
  a problem; it is the accent with its gap written out. Tokens stay in `apps/web/design/tokens.json`.
- Numbers: `font-variant-numeric: tabular-nums lining-nums` everywhere a sum stands, right aligned in lists.
- Finnish formats (`docs/UI_STYLE.md`): `1 339,64 €` with a no-break space before the euro, minus `−`, dates `9.11.` in
  the year now and `9.11.2025` otherwise, months `marraskuu 2026`. An answer and a forecast are whole euros ("noin 4 400
  €"); a row is in cents. No percentage with a decimal, no range narrower than the data can carry.
- Density: one answer per view at the top, then at most one chart, then a list. A list shows 7 rows and a link to all.
  A row is one line on a desktop and two on a phone. Hierarchy comes from size and order, never from boxes.
- Avoid: gradients, glass, shadows on cards, a grid of equal cards, emoji, icons as decoration, avatars and logos in
  rows, helper texts over one line, a chart without a comparison, fake precision, a figure twice on one screen.

## 4. States for every view

- First run, no bank yet: each view shows its title, one line of what it will answer, and one button to Asetukset >
  Pankit ja tilit. No sample figures. The wizard is two steps: a bank, and the payday (from rows once they come).
- First fetch: the answer slot says "Haetaan tapahtumia" with the count fetched. Under 3 months of rows Kuukausi shows
  sums with "tavallinen näkyy, kun takana on 3 kuukautta" in place of the usual; the other views answer from the first day.
- Loading: the answer line and the list keep their height with grey bars of the same size; no spinner on a view.
- Error: the last answer stays with its time and one line of what failed and what to do. A failed fetch is a queue item.
- Long names: a name is cut with an ellipsis on one line, the full name in the row's detail. A sum is never cut.
- Five years of data: every view reads the current period and the usual window only; the rows list pages by 100; Vuosi
  shows the last 12 months against the 12 before, with a year picker.
- Phone, 390 px: the answer fits the first screen with its comparison. Lists become blocks of two lines (name and sum,
  date and category). The four tabs sit at the bottom. No sideways scroll.

## 5. Later

- An optional AI chat over the household's own data, run on the install's own machine, off by default; Sure's chat as
  a home is the thing to avoid (`docs/research/peers.md`).

## 6. Steps

Ready to paste into `docs/ROADMAP.md`, where they take the next free numbers. Deletions first, then data, then views.
Each proof is a test or a screenshot at 390 and 1440 px attached to the PR. `pnpm check --changed` green is part of each.

### D1 Delete Säästövinkit
- why: a card grid that answers no question and repeats findings shown elsewhere.
- done when: `pages/Optimise.tsx`, `components/optimise/` and core `optimise/` are gone; `pnpm strings` finds no "Säästövinkit"; `e2e` nav spec sees four tabs.
- locks: nav, optimise
- after: none
### D2 Move the overview insights into Tarkistettavat
- why: one finding was shown twice with two counts; a problem belongs in the queue.
- done when: `components/home/Notable.tsx` is gone; a `services/review.ts` test gets one item per price rise and new recurring charge, none twice.
- locks: review, insights
- after: D1
### D3 Delete the overview extras
- why: the right column, last-days table, direction, reliability and goals repeat or compare with nothing.
- done when: `components/holdings/`, `PaceTable.tsx`, `Direction.tsx`, `Reliability.tsx`, the goal components and `categoryGoals` are gone; a shot of Nyt shows one answer and the pace line.
- locks: overview, holdings
- after: none
### D4 Strip Tapahtumat to the rows list
- why: whole-history tiles, a weekly chart and four marks per row put the list below the first phone screen.
- done when: the tiles, the chart, `MerchantAvatar.tsx`, logos, chip icons and amount bars are gone from rows; a 390 px shot shows the first row on the first screen.
- locks: transactions, table
- after: none
### D5 Fold Merchants and Rules
- why: a merchant list is a grouping of rows; rules are a setting.
- done when: `pages/Merchants.tsx` and `pages/Rules.tsx` are gone; group by merchant works in the rows toolbar; rules sit in Asetukset > Kotitalous; legacy addresses in `routes.ts` lead there (test).
- locks: transactions, settings, routes
- after: D4
### D6 Delete the report sections that go
- why: 14 sections answer a question another view answers or none.
- done when: the sections and core report ids listed in section 2 are gone with their tests and golden files (`pnpm findings --golden`), and with them the unused `charts/PriceLine.tsx`; `reports.test.ts` covers the ids that stay.
- locks: reports, golden
- after: none
### D7 Delete the unopened views counter
- why: it was the way to find what to delete; this design decides that.
- done when: `UnopenedViews.tsx` and `services/view-opens.ts` are gone, the table stays (no migration edit); `pnpm where view_opens` finds only the migration.
- locks: settings, view-opens
- after: D6
### D8 Delete the loan picture reader
- why: a loan is a few fields; OCR and PDF reading add two large dependencies for one form.
- done when: core `loan-intake/`, `LoanIntake.tsx`, tesseract.js and pdfjs-dist are gone; a loan is added by form in an e2e spec.
- locks: loans, deps
- after: none
### A1 The Nyt answer
- why: the view needs the sum left, the days left, the usual everyday spend per day and the pace band, from one place.
- done when: a core function returns them; a test holds left = balance − bills before payday to the cent and the band equals `analysis/usual.ts` to the same day.
- locks: core-usual, dashboard
- after: D3
### A2 Usual to the same day per category
- why: Kuukausi compares each category with its usual to the same day.
- done when: a core test with 12 made-up months gives each category's usual to day 9 and the list sorted by the gap.
- locks: core-usual
- after: D6
### A3 The coming list
- why: Tulossa needs bills and income to the payday after next, with each bill's last amount.
- done when: a core test merges `commitments.ts`, `expected_bills` and income into one list grouped by payday period, sums equal to the rows.
- locks: commitments, expected-bills
- after: none
### A4 One queue of what is wrong
- why: balance mismatch, an ending consent, a missed bill and unsorted rows each reach the household through one door.
- done when: `services/review.ts` returns each kind next to today's (the housing question stays); a server test makes one of each and gets one item each with its sum.
- locks: review
- after: D2
### A5 The visual tokens
- why: the sizes, the spacing steps, the neutrals, one accent and red for problems. (The four sizes this task chose were taken back on 12.11.2026: the scale is 1.0.0's, see section 3.)
- done when: `design/tokens.json` holds only them, `pnpm tokens` writes them and `apps/web/test/contrast.test.ts` passes.
- locks: tokens, styles
- after: none
### A6 Whole euros where a sum answers
- why: an answer in cents is fake precision; a row in cents is exact.
- done when: `format.ts` has the two forms; a test formats 4 424,13 as `4 424 €` in an answer and `4 424,13 €` in a row.
- locks: format
- after: none
### V1 Nyt
- why: question 1.
- done when: the view of section 1.1 replaces Yhteenveto; an e2e spec at 390 and 1440 px reads the answer equal to the A1 sum and finds no other card.
- locks: overview, nav
- after: A1, A5, A6
### V2 Kuukausi
- why: question 1.2.
- done when: the view of section 1.2 is a tab; an e2e spec opens a category and gets rows that add up to its sum.
- locks: reports, nav
- after: A2, A5
### V3 Tulossa
- why: question 1.3; replaces Laskut.
- done when: the timeline and sum lines are gone; an e2e spec adds a missing bill and sees it in the list and in the Nyt sum.
- locks: bills, nav
- after: A3, A5
### V4 Tarkistettavat as a tab
- why: question 1.4.
- done when: it is the fourth tab with its count; an e2e spec answers each item kind of A4 and sees the count fall to zero.
- locks: review, nav
- after: A4, A5
### V5 Lisää
- why: the reports that earn a place, out of the tabs.
- done when: the Raportit menu is gone; Lisää lists Vuosi, Tilit ja saldot, Lainat, Verovuosi and, with a shared account, Yhteiset; `docs/UI_STYLE.md` names the four tabs and Lisää; `e2e/table-views.spec.ts` passes.
- locks: reports, nav
- after: V2
### V6 Asetukset in three tabs
- why: six tabs and 54 files for a household that sets a bank and a payday.
- done when: Pankit ja tilit, Kotitalous and Palvelin; remote access is one form; `e2e/settings.spec.ts` passes at 390 and 1440 px.
- locks: settings
- after: D5, D7
### V7 First run and empty states
- why: section 4 for a household with no bank and with under 3 months of rows.
- done when: an e2e spec on an empty install sees each view's one line and the button to Pankit ja tilit, and the wizard has two steps.
- locks: wizard, overview
- after: V1, V2, V3, V4
### V8 Loading, error, long names, five years, phone
- why: the rest of section 4.
- done when: an e2e spec runs each view on a made-up household of five years with a 60-character merchant at 390 px: no sideways scroll, no cut sum, the first answer under 1 s on the seeded data, and a failed fetch kept as an item.
- locks: e2e
- after: V7
