/**
 * Every import parser core ships, by static import. A folder in sources/ that is not listed here fails
 * packages/core/test/sources.test.ts.
 */
import { nordeaCsv } from "./nordea-csv/index.ts";
import type { ImportParser } from "./types.ts";

/** In the order of the folders. */
export const IMPORT_PARSERS: readonly ImportParser[] = [nordeaCsv];

/** How much of a file a parser sees when it sniffs. */
const SNIFF_CHARS = 32_000;

/**
 * The parser that recognises the file best, the first one on a tie. A file that nobody recognises goes to the
 * first parser too, because its messages say what is missing (no date or amount column, a wrong character set).
 */
export function parserFor(text: string): ImportParser {
  const head = text.slice(0, SNIFF_CHARS);
  let best = IMPORT_PARSERS[0]!;
  let bestScore = 0;
  for (const parser of IMPORT_PARSERS) {
    const score = parser.sniff(head);
    if (score > bestScore) {
      best = parser;
      bestScore = score;
    }
  }
  return best;
}
