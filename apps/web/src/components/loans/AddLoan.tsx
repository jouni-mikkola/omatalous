/**
 * The form of a new loan of any kind, with the box that reads a loan's text, picture or PDF; a read of several loans, or
 * of a loan saved already, goes to the table that saves them all. Varat ja velat opens it from Lisää laina, and
 * Tarkistettavat from its home loan question with the kind set, so a loan is added the same way wherever it is asked.
 */
import type { LoanDraft, LoanKind } from "@banking/core";
import { useId, useState } from "react";
import { loanCalls } from "../../api.ts";
import { useApi } from "../../hooks.ts";
import { t } from "../../text.ts";
import type { LoansAnswer, Meta } from "../../types.ts";
import { emptyForm, setKind } from "./form.ts";
import { LoanDraftTable } from "./LoanDraftTable.tsx";
import { LoanEditor, LoanLinks } from "./LoanEditor.tsx";
import "../../styles/loans.css";

export function AddLoan({ meta, kind, onSaved, onClose }: {
  meta: Pick<Meta, "accounts" | "today">;
  /** The kind the form starts on; without it the reader picks one. */
  kind?: LoanKind;
  /** Some loans are saved: how many. The table of a read calls it also when the server refused a later row. */
  onSaved: (count: number) => void;
  onClose: () => void;
}) {
  const id = useId();
  const list = useApi<LoansAnswer>("/api/loans");
  const loans = list.data?.loans ?? [];
  const [initial] = useState(() => (kind ? setKind(emptyForm(meta.today), kind) : emptyForm(meta.today)));
  // the loans of a text read in the form, when they are several or one is saved already
  const [read, setRead] = useState<LoanDraft[] | null>(null);
  return (
    <LoanLinks.Provider value={{ accounts: meta.accounts, loans, fixings: list.data?.fixings }}>
      <section className="loan-draft" aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`}>{t("set.loans.new_loan")}</h3>
        {read ? (
          <LoanDraftTable drafts={read} loans={loans} today={meta.today} onSaved={onSaved} onClose={onClose} />
        ) : (
          <LoanEditor
            initial={initial}
            today={meta.today}
            cancelLabel={t("set.loans.cancel")}
            onSeveral={setRead}
            onSave={async (body) => {
              await loanCalls.add(body);
              onSaved(1);
              onClose();
            }}
            onCancel={onClose}
          />
        )}
      </section>
    </LoanLinks.Provider>
  );
}

/** The line Varat ja velat says after a save of the new loans. */
export const savedText = (count: number): string => t(count === 1 ? "set.loans.loan_saved" : "set.loans.loans_saved");
