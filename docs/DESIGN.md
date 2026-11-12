# Design

How the web app looks and why. The decision is in [ADR 0022](adr/0022-look-tokens-and-font.md). The words of the
interface are in [UI_STYLE.md](UI_STYLE.md). This page is for a person who builds a page or a chart.

## Principles

- Show a little at a time and let the reader drill down for the rest. A page opens with a few figures. Each figure
  leads to the rows behind it.
- One question per page. The page name is the question, the first figure is the answer, and everything below
  explains the answer. A view that answers no question the household has is not built.
- A number and its comparison stand together. A month's spending has the usual month beside it, a rate has the rate
  it is compared with. A figure with no comparison is a number the reader cannot judge.
- Sections are separated by a heading and a hairline. There are no boxes, no shadows and no gradients.
- The look is one light, bank-like theme: a pale grey page, white surfaces and a dark blue header band. Text is dark at 7 to 1 or more, parts of the interface are at 3 to 1 or more,
  and no meaning rests on a colour alone: a status has a sign or a word beside its colour.

## Tokens

`apps/web/design/tokens.json` is the only place where the look is set. It is in the Design Tokens format (2025.10).
A value of the look is a line in it. `pnpm tokens` writes two files from it, and a test fails when either differs
from the source:

- `apps/web/src/styles/tokens.css`: the custom properties, in `@layer tokens`. A token's CSS name is its key with two
  dashes in front, so the key `surface-2` is `--surface-2`.
- `apps/web/src/design/tokens.ts`: the same values for script. Charts and other code take colours from `color`,
  `series` and `hex` there. A `.ts` file does not hold a colour of its own.

What there is:

- Surfaces are `--page`, `--surface` and `--surface-2`.
- Text colours are `--text`, `--text-2` and `--muted`.
- Lines are `--border` and `--grid`. `--accent` marks what is chosen.
- `--good` is money in and `--bad` is money out. `--warn` is a warning.
- `--estimate-fill` and `--estimate-edge` tint an estimate. `--ink` is the header band.
- Category colours are `--series-1` to `--series-7`, always in that order. The heat ladder has four steps and an ink for each.
- The type scale is 12 px, 14 px, 16 px, 20 px and 32 px. Their tokens start with `--fs-`.
- One display size, `--fs-display` (3.25 rem), is for the answer number of a page.
- Weights are 400 and 600. Sums and tables use `font-variant-numeric: tabular-nums`.
- The font is IBM Plex Sans Variable.
- Space is in steps of 4 px, `--sp-4` to `--sp-48`. A test holds every step to a multiple of 4. `--pad` and `--gap` change with the width of the page.
- Radii are `--radius` (0), `--radius-s` (2 px) and `--radius-m` (4 px).
- The shadow `--pop-shadow` is for a popup only.
- Motion is `--t-press`, `--t-state`, `--t-open`, `--t-draw`, `--t-stagger`, `--t-pulse` and `--ease-out`. Under `prefers-reduced-motion` the durations are 0.

To change the look, change a value in `tokens.json` and run `pnpm tokens`. To add a value, add a line there.
Never write a px value, a colour, a font-size or a duration by hand in a stylesheet. Repo rule 40 refuses it. The rule also refuses
a token set again outside `tokens.css`, a `setProperty` call, a look value in an inline `style` and a colour in a `.ts`
file. The files that still hold such values are on `tools/repo-rules/css-tokens-baseline.txt`. That list only shrinks.

Stylesheets sit in cascade layers. `base.css` declares them once: `reset, tokens, base, components, pages, utilities`.
A shared part such as the table or the shell is in `components`. A page's own sheet is in `pages`. The rules that
measure something real (`marks.css` and `motion.css`) are in `utilities`. The order of imports does not decide the
cascade. There is no Tailwind and no utility class.

`apps/web/test/contrast.test.ts` measures every colour pair against the numbers above. It also checks that the status
colours stay apart for a reader with a colour vision deficiency. When a token fails, move the colour and leave the test.

## Components

- Table: every list of rows is `components/table/Table.tsx`. A page writes cells and never a `<table>`. Under 600 px a
  row becomes a block. A row is 32 px high (`--row-h`) with a hairline under it, and Tapahtumat shows at least twelve
  rows on a 1440 x 900 screen.
- Table toolbar: a table whose columns define something to choose, or that has more than ten rows to search, has one toolbar above it (`components/table/Toolbar.tsx`,
  `styles/toolbar.css`). On the left stand a search box and filter chips with the number of rows each leaves ("Kaikki 21").
  On the right stands the grouping menu. The search box shows only for a list of more than ten rows (`LONG_LIST_ROWS`).
  "Lataa CSV" is no button of the bar: a long table has it as one link under it. The chips, the search text and the grouping come from the column
  definitions (`chips`, `search`, `group`), never from the page. A chip's count is the number of rows the table shows
  when the chip is chosen. The CSV holds the rows shown, in the order shown, with sums as numbers. A table with nothing
  to choose has no toolbar (the security log, the members, the accounts). The sorted column shows an arrow and `aria-sort`. Under 600 px the head is hidden, so the
  toolbar carries a "Järjestys:" choice. An opened row shows its newest transactions under one sentence from the
  server's figures. Ten rows show at most, then "Näytä kaikki" opens Tapahtumat with the same filter. Escape closes
  the row and the focus returns to it.
- Section: a heading, a hairline under it and the content. `.card` is the class of that section. It has no fill and no
  border.
- `Card` (`components/ui/Card.tsx`) stays only for the files that import it now, which are on
  `tools/repo-rules/card-users.json`. It is removed with the last of them, and new code does not import it.
- The name strip of a section (`.card-head`): the name on the left and the section's one action on the right, in the
  same place in every section. A status of one line may stand under the name (`.card-sub`). A button under an empty
  line or under the heading is moved into the strip.
- Empty line (`.empty`, `Empty` with no title): one line in the secondary colour at the height of a row, so a section
  keeps its height when its first row comes. A part with nothing to show and nothing to do is not drawn.
- Foot (`.sheet-foot`): the label size and the muted colour, links too, under a hairline of the section colour. It is
  the frame, so it is quieter than the page. Its one sentence of a fetch that runs or is held back has the secondary
  text colour, so it reads as a status and not as the frame.
- Key figures: one strip with a vertical hairline between figures. The first figure of a page may use the display size.
- Marks: a merchant is its initials on a plate, a bank is its logo. A row has one mark, not an icon beside every field.
- `components/ui/` holds the button, the chip, the tabs and the notice. They read tokens only.

## Charts

- Charts are in `apps/web/src/charts` and read their colours from `src/design/tokens.ts`.
- One axis per chart. Every chart has a legend and a table view with the same numbers.
- Category colours keep the order the server sends, so a category is the same colour on every page.
- The heat ladder runs from the surface to a dark blue. The ink on a step reads at 7 to 1.
- Lines and bars are told apart by more than their hue: a dash, a label or a position.

## Forbidden

- Gradients, except the drawn face of a bank card in `holdings.css`.
- A card, a panel or a rounded grey box around a section.
- Shadows other than the popup's.
- Emoji and icons used as decoration. An icon stands for an action or a state and has a name for a screen reader.
- Violet or blue-violet as the accent, and a second accent colour.
- A second theme (a dark one too), `light-dark()`, `prefers-color-scheme` or an attribute that switches the look.
- A centred hero with three cards under it.
- A font other than the one in `--font-body`, and a font size or weight outside the scale.
