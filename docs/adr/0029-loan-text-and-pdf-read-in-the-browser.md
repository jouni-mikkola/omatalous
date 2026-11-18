# 0029 The text, PDF or picture of a loan is read in the browser, and only the loan's fields reach the install

## Context

A loan is a short form, and the household had to type every field of it. A bank's page or a PDF statement lists the same
fields (lender, granted amount, balance, rate, payment, last due day). Typing them again is slow and makes mistakes.

The earlier design removed the loan picture reader (design record D8): two large dependencies, Tesseract for pictures and
pdf.js for PDFs, for one form. The reading of the text itself, the part that finds the fields, is small and has been
rebuilt in core as `loan-intake/` (`parseLoanText`), with a mark on each field that says how sure the reading is. A phone
gives a screenshot of the bank's page more often than a text, so pictures are read again, as a fallback.

ADR 0025 made one exception to "the app reads no files": a card statement, read in the browser. This is a second.

## Decision

- The new-loan form has one input box. It takes pasted text, a dropped or chosen text file, a PDF, or a picture.
- The text is read in the browser. A PDF goes through pdf.js (`pdfjs-dist`, pinned to one version), which reads the text
  layer of at most 20 pages. pdf.js and its worker load on first use, as files of the app's own `/assets`. No other
  address is called, and the content policy is unchanged. The first page and the service worker's list do not carry it.
- A picture goes through Tesseract (`tesseract.js` 7 with the Finnish and English `best_int` data, pinned to one version),
  which runs in a worker of the browser. Its worker, its two WebAssembly cores (with and without SIMD) and the language
  data are files of the app's own `/assets/ocr-<hash>/`, loaded when the first picture arrives. No other address is
  called. The server image has no new dependency. A picture of at most 40 million pixels and 25 MB is read; a larger one
  is refused from its header, before it is decoded. A text that arrives with a pasted picture (Word and Excel put both on
  the clipboard) is read as the text, since it needs no guessing.
- Every field read from a picture is marked *Tarkista*, also one the text would have given with confidence: the letters
  of a picture are guessed.
- A PDF that is only a picture, or one under a password, gets a sentence that says so.
- The content policy is unchanged. Its `script-src` already holds `'wasm-unsafe-eval'` for pdf.js, which is all the
  Tesseract cores need, and the worker is started from the app's own address (no blob address, no `unsafe-eval`).
- The server takes no file. The request is the loan's own fields, as before (`POST` and `PUT /api/loans`).
- Every field read with doubt (`check`) is marked, and saving waits until the household has confirmed or changed it. A
  field the text does not give stays empty and is marked as not found, never 0.
- A text of several loans, or of a loan that matches a saved one, opens a table where each loan is matched to a saved
  loan or saved as new, and one Tallenna saves all of them.
- This reverses D8 for text, PDF and pictures.

## Weighed and left

- **Reading on the server.** It would need an upload route and a parser there, and it puts the household's papers on the
  server. The browser can read the text itself.
- **Saving a picture's fields as sure.** A picture read wrong is the worst case for a figure of money, so none of its
  fields is taken without a look.
- **The reader in the first page or the offline file list.** It is about 11 MB, needed only while a picture is read.
- **Saving without confirmation.** A figure misread from a PDF becomes a wrong debt in every report.

## Consequences

- `pdfjs-dist`, `tesseract.js` and the two language data packages are dependencies of the web app again, listed in
  `THIRD_PARTY_NOTICES` with the licence of the language data (the Tesseract OCR project's `tessdata_best`, Apache-2.0).
  Their size is in lazy chunks and files that are outside the bundle budget and outside the offline file list.
- The e2e run reads PDFs made from bytes (`e2e/pdf-fixtures.ts`) and a picture drawn in the page from made-up values
  (`e2e/loan-picture.spec.ts`), and checks that the file itself is not sent.
- A bank whose page the reader does not know is read as far as its labels match: the fields found are filled and the
  rest stays empty, marked as not found.

## When to think again

- When households paste or choose files that the reader leaves empty, with a made-up example of the layout.
- When the browser can hand over the text of a screenshot itself in the way a phone's own text copy does, and the
  Tesseract files are no longer worth their size.
