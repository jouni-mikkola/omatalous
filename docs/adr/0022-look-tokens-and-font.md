# 0022 The look: tokens, one light theme and IBM Plex Sans Variable

Changed by BA-76: the one look is the light, bank-like one that the app had before this record. The dim grey look this
record first chose is deleted, and no dark form is kept. Colours are the old light ones, moved by the smallest step where the 7 to 1 tests needed it (the status text, the four tints and the heat ladder).

## Context

The look of the app was written twice: in the stylesheets as values and in the charts as their own constants. The
page was a light grey sheet with a round card around every section, shadows on buttons and a second, night look
chosen by an attribute. [ADR 0019](0019-ui-stack.md) decided that the look comes from one token file, and left the
direction, the font and the colours to a later record. This is that record.

Three directions were built with the real figures of the example household and compared at 1440 and 390 px against
the same checks: contrast, colour vision deficiency, rows on a screen, font size in kB and the anti-default checker.
The household reads the app for a few minutes at a time, mostly on a laptop and on a phone, and the figures are the
point of the page.

## Decision

- One look. The page is pale grey, the surfaces are white and the header band is dark blue (first choice: dim grey). Text is dark and reads at 7 to 1 or more on every surface.
  Parts of the interface and status symbols read at 3 to 1 or more. The status colours stay apart for a reader with a
  colour vision deficiency. There is no night look and no second set. There is no `light-dark()`, no
  `prefers-color-scheme` branch and no attribute that switches a set. This replaces `light-dark()` in the plain CSS row of 0019.
- Direction "Grafiitti". Sections are a heading and a hairline, without a box, a shadow or a gradient. The accent is a
  mid blue. The category colours are seven hues in a fixed order, none of them violet. The heat ladder runs
  from the surface to a dark blue, with a dark ink on the two pale steps and a white one on the two dark steps.
- Font: `@fontsource-variable/ibm-plex-sans` with the weight and width axes in latin and latin-ext. Its digits have one
  width, so columns of sums line up. The width axis gives the phone a narrower cut (94 %). A long Finnish compound word
  and a sum then fit one row. The stack starts with `IBM Plex Sans Variable`. `@fontsource/ibm-plex-sans` is removed.
  Sums and tables use `font-variant-numeric: tabular-nums`.
- Size of the font package: 112 kB of woff2 (latin 65 kB, latin-ext 47 kB) against 79 kB for the two static weights
  before, so +33 kB.
- Tokens: `apps/web/design/tokens.json` in the DTCG 2025.10 format is the only place where the look is set. `pnpm tokens` (`tools/tokens/build.ts`) writes `styles/tokens.css` and
  `src/design/tokens.ts`. A test fails when either differs from the source. Charts take their colours from
  `tokens.ts`.
- Type scale: 12, 14, 16, 20 and 32 px, and one display size, 3.25 rem, for the answer number only.
- Shadows: one, for a popup. Radii: 0, 2 and 4 px.
- Layers: `@layer reset, tokens, base, components, pages, utilities;` is declared in `base.css`, and each stylesheet
  sits in one layer, so the order of imports no longer decides the cascade.
- The look is checked by machine. The repo rule `tools/repo-rules/css-tokens.ts` refuses a new px value, hex colour or
  `font-size` literal in a changed stylesheet, a token set outside `tokens.css`, `setProperty`, an inline style that carries a look value and
  a colour in a `.ts` file. Files that still hold such values are on a list that only shrinks. The drawn card face of
  `holdings.css` is the one named exception.

## Rejected

- A pair of a text face and a serif face (182 kB, two figure styles): twice the font weight for headings the page
  does not need, and its rows are 40 px.
- A single face of 53 kB with 28 px rows: the smallest package and the densest rows, but it changes the face the app is known by, and the density
  goal is met by Grafiitti with 32 px rows.
- Two looks from one file: the owner decided on one look. A second look doubles the contrast tests and the pictures to check.
- Keeping the cards: a box round each section is the shape of a generated app, and a section needs only a heading and a line.

## Review

Review again: 2027-04-26. Measure the font package and count the rows on Tapahtumat at 1440 x 900 (12 now). Run the
anti-default checker. If the direction changes, the change is the values in `tokens.json`, the font package and
`--font-body`, `--row-h` and `--pad`. Components read tokens only.

## Consequences

- A new value is a line in `tokens.json` and a run of `pnpm tokens`.
- `Card` (`components/ui/Card.tsx`) stays for the pages that import it now and is removed with the last of them. New code does not import it.
- The night look and its README picture are gone, with `pnpm shots --look`.
- `docs/DESIGN.md` has the principles and the forbidden list.
