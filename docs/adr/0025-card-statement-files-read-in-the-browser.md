# 0025 A card statement file is read in the browser, and only its rows reach the install (0.70.0)

## Context

The app has said since 0.9.0 that it reads no files: the CSV import was removed, no route takes a file and every request
body is limited to 256 KB. The rule keeps the server small and keeps a household's papers off it.

Some banks do not give a card's rows through PSD2. The household then has the card bills in the current account and no
purchases behind them. The card statement the bank does give is a file (CSV, text or PDF).

The browser already reads files for the loan intake (`LoanIntake.tsx`: pdf.js and Tesseract, nothing sent). That is a
precedent for reading in the page, and the rows it finds are saved only after the user confirms.

## Decision

The rule "the app reads no files" gets one limited exception. The browser reads a card statement file, and only the rows
go to the install.

- The file is read in the page. A PDF goes through the same pdf.js reader as the loan intake. A text file is decoded
  as UTF-8, else Windows-1252. `readCardFile` (core, pure) finds the layout from the text, never from the file's name.
- The request holds rows (a day, a sum, a text) and the card's name or one of the household's statement cards. It
  never holds the file, its name, its text around the rows or its layout. `POST /api/card-file` rejects any other field
  (`strictObject`) and keeps the 256 KB limit. There is still no route that takes a file.
- The rows are a source of their own: connector `cardfile`, stored in `accounts.provider` and `transactions.source`
  and never renamed. They go through `ingestTransactions` like a fetch, so the same statement read twice stores each
  row once (the ids come from the day, the sum, the text and the row's turn among equal ones).
- A card bill paid from another account is matched to the card's payment row by the transfer pairing that exists
  (ADR 0015), and the purchases are the spending. Nothing new decides that.
- Only a card made here takes rows. A bank's account is filled by its own fetch.
- Three layouts are read: a semicolon table, a tab table and the lines of a statement's text. Each is told by its own
  header. The layouts are described, not copied from a bank's file, and are held by made-up statements in
  `packages/core/test/card-file.test.ts`. A bank with the same layout works; a bank with another does not until a
  layout is added there.

- A bank's CSV row may also hold the payment message (*viesti*): an optional fourth field, `message`, read from a column the
  household matched (guessed from a header that says *viesti* or *message*). The route's `strictObject` allows that one
  new key, as text of at most 120 characters, like the row's text. It is stored as the transaction's `description`, so a
  message such as a salary note sorts the row. A message that is only an account number or the row's text again is left
  out. The row id still comes from the day, the sum, the text and the description, so the same file read twice stores
  each row once; a row stored before the message was read is a twin of the same row with it and is skipped, not doubled.

## Weighed and left

- **The server reads the file.** It would need an upload route, a size and type check, a parser on the server and the
  file in memory there. It breaks the rule for all files, not for rows.
- **Only PDF, or only CSV.** Banks give both. A PDF reader exists already, and a text file needs none.
- **A format picker.** The household would have to know the layout. The header tells it.

## Consequences

- A statement of a layout not listed is refused with a sentence that says so. A layout is one reader in
  `card-file.ts` and one made-up statement in its test.
- The page says that the file is read in the browser. The e2e run (`e2e/card-file.spec.ts`) records every request and
  fails when one carries the file's text.
- A bank's CSV export follows the same rule (BA-58): read in the browser, rows to the install, a source of their own
  (connector `bankfile`, `POST /api/bank-file`). The columns are matched by the household and remembered in the browser
  under the file's header, so the install never sees the header. A camt.053 statement follows too (BA-59): the same route, with the closing balance checked against the rows in the browser, so a file that does not add up never reaches the install.

## When to think again

- When a real bank's statement does not read: add its layout, with a made-up statement.
- When the app reads a file for any other purpose than rows of a bank document: that needs its own record.
