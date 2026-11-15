/** The text a category rule reads of a row, kept apart from the rules themselves (categorize.ts). */
import { dropBankFigures } from "./bank-figures.ts";
import type { CategorizeInput } from "./categorize.ts";
import { fold } from "./merchant.ts";
import type { RuleField } from "./types.ts";

/**
 * The text a rule reads. The built-in rules read the description without the bank's figures (`dropBankFigures`); a
 * user's rule reads it as the bank wrote it, as the user saw it when writing the rule.
 */
export function fieldText(input: CategorizeInput, field: RuleField, byUser: boolean): string {
  const description = (text: string) => (byUser ? fold(text) : dropBankFigures(fold(text)));
  switch (field) {
    case "merchant":
    case "merchant_exact":
      return fold(input.merchant);
    case "counterparty":
      return fold(input.counterparty ?? "");
    case "description":
      return description(input.description ?? "");
    case "any":
      return fold([input.merchant, input.counterparty, input.description && description(input.description)].filter(Boolean).join(" | "));
  }
}
