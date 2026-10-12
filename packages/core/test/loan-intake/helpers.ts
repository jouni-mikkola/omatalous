import type { LoanDraft, LoanDraftKey } from "../../src/index.ts";

/** A draft as `{ field: "value confidence" }`: one `toEqual` pins every field, its value and its confidence, and that no other field was read. */
export function read(draft: LoanDraft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(draft) as (LoanDraftKey | "warnings" | "paymentKind")[]) {
    if (key === "warnings" || key === "paymentKind") continue;
    const field = draft[key]!;
    out[key] = `${field.value} ${field.confidence}`;
  }
  return out;
}

export const warned = (draft: LoanDraft) => draft.warnings.map((w) => w.id);

export const text = (...lines: string[]) => lines.join("\n");
