# Omatalous: UI, a critical review

## Verdict
The web app is calm and fast. Every API answer on a walk of all pages came back in under 210 ms cold and under 30 ms warm, and the empty states, the statement import and the transaction list work well at 1440 and 390 px. What is weak is how the numbers connect. On Nyt, 1 900,54 € of "laskut ennen palkkapäivää" cannot be opened and cannot be found on Tulossa, because Tulossa leaves out the 1 822,28 € card bill. On Kuukausi, 77 % of the month sits in one "Muut luokat" row that cannot be opened. The pace chart names a 9,10 € coffee as the month's "Suurin yksittäinen osto". Smaller faults: R1, merged today, shows a second failed-reload line on Nyt. Pages carry three names (tab Nyt, title Yhteenveto; tab Tulossa, title Laskut, card Tulevat maksut). A Palvelin checkbox points to a page that no longer exists and changes nothing.

Evidence: demo household (`pnpm seed:demo`) plus an empty member and a member with one imported CSV, served by the built app on :5313. Screenshots are in /tmp/XTU/ (`*-1440.png`, `*-390.png`, `err-*.png`, `empty-*.png`, `young-*.png`).

## Findings

1. **Nyt's bills figure cannot be traced. Tulossa leaves out the largest bill and the income it promises.** (misleading)
   Nyt says "Saldo 4 925,21 € − laskut ennen palkkapäivää 1 900,54 €" (`components/home/Nyt.tsx:57`). The figure is `ahead.totals.leavingCents` (`packages/core/src/analysis/nyt.ts:77`). Its rows in `/api/dashboard` `ahead.rows` are the card bill "Nordea Gold (esimerkki)" 1 822,28 € (11.11.), Helen 48,36 € and Elisa 29,90 €. Tulossa (`pages/Bills.tsx`) builds its list from `/api/recurring` series instead (`billItems`). It has no card bill. Its rows dated before 25.11. add up to about 190 €. It has no payday period and no sum, and no income row, although its empty state says "Tässä näet, mitä laskuja ja tuloja on tulossa". The owner sees 1 900 € taken off the answer and nowhere to check it. Design 1.1 says the sum opens "the balance and the bills behind it". Design 1.3 says Tulossa is grouped by payday period with income.
2. **The figures on Nyt open nothing.** (misleading, navigation)
   `Nyt.tsx` renders the answer, the pace line and the parts line as plain text. The snapshot of `#/overview` has no link or button in `main`. The owner also has no route at all to Tapahtumat: no tab, no user-menu entry (`Shell.tsx:73`, the menu at `:340-352` holds Kieli, Lisää, Asetukset, Kirjaudu ulos). The only way in is a sum on Kuukausi, which looks like bold text.
3. **Kuukausi hides most of the month in a row that cannot be opened.** (misleading)
   `#/reports` on 11.11. shows five categories and "Muut luokat 1 562,52 €" out of 2 027 €. October shows "Muut (12) 1 881,45 €" out of 3 850 €. The rest row has no drill (`pages/reports/Month.tsx:92-101`: `x.category === null` renders plain `money`). Core folds every category whose gap is 0 or small into it (`packages/core/src/reports/this-month.ts:79-85`), so rent (Sato 1 050 €) is never visible. The same row is called "Muut luokat" in the running month and "Muut (12)" in an earlier one.
4. **"Suurin yksittäinen osto Robert's Coffee" is false.** (misleading)
   `/api/dashboard` `pace.largest` = `{day: 11, name: "Robert's Coffee", cents: 910}`. Hesburger 80,68 € (8.11.) and Prisma 46,21 € are larger. `largestOneOff` (`packages/core/src/analysis/forecast.ts:137-143`) skips every row of every recurring series. In the demo that is 31 series, including Prisma, Hesburger, K-Market and Alko. The pending coffee is left only because it is not yet in its series. The label also hides the sum (`messages-overview.ts:111`).
5. **Two failed-reload lines on Nyt.** (ugly, confusing)
   With `/api/dashboard` answering 500 after a first load (`err-overview.png`), the shell's `StaleAnswer` shows "… Tulokset ajalta 11.11. klo 19.26. Yritä uudelleen". Under it, the notice R1 added (`pages/Overview.tsx:63-68`) shows the same error with a second "Yritä uudelleen". `StaleAnswer` already does this on every page (`components/StaleAnswer.tsx`, `hooks.ts:48-70`).
6. **The pace chart's labels break at 390 px and mix two series.** (ugly, misleading)
   At 390 px (`overview-390.png`) the event label "Suurin yksittäinen osto Robert's Coffe" runs off the right edge and overlaps "Palkka 25.". At 1440 px the end label reads "Tavallinen" in grey and, right under it, "≈ 3 114–3 336 €" in blue. That range is the month-end estimate (`PaceChart.tsx:152-155`), but it reads as the usual month.
7. **One page, three names; Lisää lights the Kuukausi tab.** (inconsistent)
   Document titles and h1 (measured): tab Nyt → "Yhteenveto · Omatalous"; tab Tulossa → "Laskut · Omatalous", with its first card "Tulevat maksut"; Lisää (`#/reports?q=saldot`) → "Kuukausi · Omatalous" with the Kuukausi tab marked current. Source: the `title` getters in `nav.ts:24,27`, and `current={page === e.id}` in `Shell.tsx`. The empty states already use the tab names ("Nyt", "Tulossa").
8. **A Palvelin setting that does nothing.** (misleading)
   Asetukset > Palvelin offers "Hae Tilastokeskuksen kuluttajahintaindeksi", with help text that compares prices "sivulla Kiinteät menot" (`messages-set-iform.ts:22`). That page is gone, and no core code reads `inputs.priceIndex` (`grep -rn priceIndex packages/core/src` finds only the type). When it is ticked, the server still fetches statfin.stat.fi daily (`services/price-index.ts`) for nothing.
9. **The bank app checklist states undone steps as done.** (misleading, a11y)
   The wizard and Asetukset > Pankit ja tilit list "Salausavain luotu", "Varmenne lisätty Enable Bankingiin", "Sovelluksen tunnus toimii" and "Pankkitilisi yhdistetty Enable Bankingissa" before any of them is done. Only a grey "–" against a green "✓" tells them apart, and both are `content: … / ""`, so a screen reader hears four finished facts (`pages/settings/BankAppSetup.tsx:231-237`, `styles/settings.css:74-78`).
10. **Phone: the Tarkistettavat count is clipped and the footer is out of line.** (ugly)
    At 390 px the count badge sits at `right: 0` of the last tab and its right edge is the screen edge (`styles/shell.css:89`; measured badge right = 390). It covers the end of "Tarkistettavat". The footer's links get `min-height: 44px` (`base.css:283`) while its spans do not, so "1.0.0", "AGPL-3.0" and the date float above the links on every page (`reports-390-bottom.png`).
11. **An unknown payday is a dead end.** (unclear)
    A member with one imported pay sees "Emme tiedä palkkapäivääsi, joten emme voi laskea, paljonko päivässä jää." (`young-overview-390.png`). It does not say what is missing or when the answer comes. Core needs three pays (`MIN_PAYS = 3`, `analysis/pay-estimate.ts:39`), and there is no setting for the payday.

Good, no step: speed (all pages under 0.3 s on this data); the empty states; the statement import (columns guessed, rows shown before saving, the "Tallennettu. Uusia rivejä 4" result); keyboard focus rings; no sideways scroll at 390 px on any page walked; the transaction list at both widths. R2 to R6 are merged and were not re-checked beyond the walk.

## Steps

The steps of this review are in [ROADMAP.md](../../ROADMAP.md) under "Review 11 Nov: UI, a critical review (XTU)".
