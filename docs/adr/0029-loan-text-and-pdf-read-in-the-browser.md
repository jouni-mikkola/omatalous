# 0029 The text or PDF of a loan is read in the browser, and only the loan's fields reach the install

## Context

A loan is a short form, and the household had to type every field of it. A bank's page or a PDF statement lists the same
fields (lender, granted amount, balance, rate, payment, last due day). Typing them again is slow and makes mistakes.

The earlier design removed the loan picture reader (design record D8): two large dependencies, Tesseract for pictures and
pdf.js for PDFs, for one form. The reading of the text itself, the part that finds the fields, is small and has been
rebuilt in core as `loan-intake/` (`parseLoanText`), with a mark on each field that says how sure the reading is.

ADR 0025 made one exception to "the app reads no files": a card statement, read in the browser. This is a second.

## Decision

- The new-loan form has one input box. It takes pasted text, a dropped or chosen text file, or a PDF.
- The text is read in the browser. A PDF goes through pdf.js (`pdfjs-dist`, pinned to one version), which reads the text
  layer of at most 20 pages. pdf.js and its worker load on first use, as files of the app's own `/assets`. No other
  address is called, and the content policy is unchanged. The first page and the service worker's list do not carry it.
- Pictures are not read. A PDF that is only a picture, or one under a password, gets a sentence that says so. Tesseract
  stays out.
- The server takes no file. The request is the loan's own fields, as before (`POST` and `PUT /api/loans`).
- Every field read with doubt (`check`) is marked, and saving waits until the household has confirmed or changed it. A
  field the text does not give stays empty and is marked as not found, never 0.
- A text of several loans, or of a loan that matches a saved one, opens a table where each loan is matched to a saved
  loan or saved as new, and one Tallenna saves all of them.
- This reverses D8 for text and PDF. Pictures stay removed.

## Weighed and left

- **Reading on the server.** It would need an upload route and a parser there, and it puts the household's papers on the
  server. The browser can read the text itself.
- **Pictures with Tesseract.** The dependency and its data are large, and a picture read wrong is the worst case for a
  figure of money. A screenshot's text can be copied from the page it came from.
- **Saving without confirmation.** A figure misread from a PDF becomes a wrong debt in every report.

## Consequences

- `pdfjs-dist` is a dependency of the web app again, listed in `THIRD_PARTY_NOTICES`. Its size is in a lazy chunk that
  is outside the bundle budget and outside the offline file list.
- The e2e run reads PDFs made from bytes (`e2e/pdf-fixtures.ts`) and checks that the file itself is not sent.
- A bank whose page the reader does not know is read as far as its labels match: the fields found are filled and the
  rest stays empty, marked as not found.

## When to think again

- When households paste or choose files that the reader leaves empty, with a made-up example of the layout.
- When a loan is wanted from a picture: that needs its own record and a reason that outweighs the dependency.
