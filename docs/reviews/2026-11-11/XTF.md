# Omatalous: functionality

## Verdict
The money core is in good shape. All 8 490 tests pass on main (`pnpm test`: 538 files, 87 s). The figures I worked by hand matched to the cent: a 100 000 € annuity loan at 4 % (first interest 333,33 €, interest of 12 months 3 956,72 €, 300 payments, payoff 2051-11-01), the month estimate (*Odotettu*) of a made-up 8-month history (1 153,99 €, with the one-off 400 € restaurant row and the quarterly bill handled as the docs say), *Tulos*, and the payday moved off a Sunday to Friday the 13th. Categorising 57 typical Finnish payees gave no wrong category. The API refused every bad range and limit I sent with a 400 and never a 500.

The faults are in the file import path:
1. A bank file counts money twice when the same account is also bank-connected.
2. Nordea's own CSV export does not read at all.
3. A CSV's text column is guessed from the wrong column.

A refused save says "try again" whatever the reason. The month estimate on Kuukausi also leaves out the bills the household typed in.

## Findings

1. **A bank file and a bank link of the same account double every row (broken, wrong money).**
   - Where: `apps/server/src/services/card-file.ts:65-82`. `saveStatementRows` always writes to an account of its own (`bankfile-…`, `iban: null`) and refuses any other account ("only a card made here takes rows").
   - `connectors/fold-accounts.ts:19` folds only the old `csv` provider, matched by IBAN. A `bankfile` account has no IBAN and is never folded.
   - Evidence: on the demo I posted the September money-out rows of *Käyttötili* as a bank file (`POST /api/bank-file`, 5 rows). September's `consumptionCents` went from 342 814 to 455 640, `debtCents` from 28 900 to 57 800 and `leftCents` from −21 714 to −178 440. Nothing in `/api/review` or the data notice told me.
   - Why it matters: the most natural use of the file reader is the history before the bank link's window. A household that reads that history, or connects its bank later, gets every overlapping day counted twice in Menot, Tulos, Odotettu and the reports, and nothing says so.

2. **Nordea's netbank CSV reads no row (broken).**
   - Where: `packages/core/src/bank-csv.ts:161-170`. `day()` takes `2026-09-03` and `3.9.2026` only. Nordea's new netbank writes `2026/09/03`; the open-source reader ZeiP/viiteaineistomuunnin, `app/helper.py` `transform_nordea_csv`, falls back to `'%Y/%m/%d'`.
   - Evidence: `readBankCsvRows` on `Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta` with rows dated `2026/09/03` returns `{"error":"no_rows"}`.
   - The household can re-pick columns but has no date format to pick, so the file of the app's main bank cannot be read.

3. **The CSV text column is guessed from an account number or the household's own name (misleading, wrong categories).**
   - Where: `bank-csv.ts:120-148`. `TEXT_ORDER`'s first rank is any header with `saaja|maksaja`, and the first such column wins.
   - Evidence: for the Nordea header the guess is column 2 `Maksaja`, which holds an IBAN. For a header with `Maksaja` before `Saajan nimi`, every payment out gets the payer, which is the household itself (`"MATTI MEIKÄLÄINEN"` for a K-Market row in my run).
   - A row whose chosen cell is empty, such as a bank fee with only a title, goes to `unread` and its money is lost, told only as a count.
   - The layout has one text column, so a file with one column for the payee and another for the payer is always wrong in one direction.

4. **A refused bank or card file says "Yritä uudelleen" whatever the reason (misleading).**
   - Where: `apps/web/src/pages/settings/BankFile.tsx`, `save()`'s `catch { setProblem("save") }`, and the same in `CardFile.tsx:42`.
   - The server's own sentence (`card_file.future` "Tiedostossa on tulevaisuuteen päivättyjä rivejä.", `card_file.bad_account`, `card_file.too_many`) is dropped, and the user is told to retry something that will fail again.
   - One row dated after today, such as a due-date payment in the export, refuses the whole file (`card-file.ts:62`). The page never says which row.

5. **Kuukausi's month estimate leaves out the bills the household typed in (misleading).**
   - Where: `packages/core/src/reports/this-month.ts:104-170`. The bill list and `stillComingCents` read `ctx.recurring` only, never `inputs.expectedBills`.
   - Evidence: I added *Kiinteistövero* 600 € due 2026-11-20 (`POST /api/expected-bills`). `/api/dashboard` `ahead.upcoming` has it, but `/api/reports?reports=thisMonth` gives `bills` without it, `billsCents` 19 000 and estimate 120 399. The estimate should be 180 399.
   - `expectedBillRows` (`analysis/forecast.ts:201`) already leaves out a date a series carries or a row paid, so adding its rows counts nothing twice.

6. **A year's bank file is refused, and a camt.053 file cannot be split (slow, a nuisance).**
   - Where: `CARD_FILE_MAX_ROWS = 1000` (`packages/core/src/card-file.ts:15`) is checked by `readBankCsvRows`, `readBankCamt` and the route.
   - A household account makes about 1 500 rows a year, so the household must export the period in pieces. A camt file cannot be cut by hand at all, because its balances must still add up.

Checked and good, no step: the loan plan and debt path, payday and banking days (Finnish holidays right), *Odotettu* and pace, *Tulos* and cash flow, categorising, the user's category surviving a re-import, re-import of the same file (`updated` 72, `changed` 0), pending-to-booked matching in `ingest.ts`, camt balance check, the hourly tick's chores, API input checks.

## Steps

The steps of this review are in [ROADMAP.md](../../ROADMAP.md) under "Review 11 Nov: functionality (XTF)".
