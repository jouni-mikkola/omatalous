/**
 * Facts of the savings area: none. The yield is the household's own (interest paid on its savings accounts over its
 * mean balance), and Finnish banks pay deposit interest after the 30 % withholding tax (laki korkotulon lähdeverosta
 * 1341/1990, 3 §), so no national figure enters the sum. Applying a tax rate to it would tax it twice.
 */
import type { Fact } from "./index.ts";

export const SAVINGS_FACTS: readonly Fact[] = [];
