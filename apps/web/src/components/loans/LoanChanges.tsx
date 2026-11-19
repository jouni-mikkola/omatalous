/**
 * The changes of a saved loan in its drill in Varat ja velat, the one place a loan is kept: Muokkaa opens the whole loan
 * in a dialog, Poista laina removes it after a confirmation, and the box under them reads the loan's text, picture or
 * PDF into the table that saves the read figures over the loan. A connected debt (`account:` id) has no saved loan, and
 * a loan another member typed in is changed by them alone, so neither has these.
 */
import type { Loan, LoanDraft, LoanRow } from "@banking/core";
import { useEffect, useState } from "react";
import { loanCalls } from "../../api.ts";
import { useApi } from "../../hooks.ts";
import { usePageAddress } from "../../page-address.ts";
import { LOAN_LINK_PARAM } from "../../routes.ts";
import { t } from "../../text.ts";
import type { LoansAnswer, Meta } from "../../types.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { useModal } from "../useModal.ts";
import { formOfLoan, linkChoices } from "./form.ts";
import { LoanDraftTable } from "./LoanDraftTable.tsx";
import { LoanEditor, LoanLinks } from "./LoanEditor.tsx";
import { LoanSource } from "./LoanSource.tsx";
import "../../styles/loans.css";

/** A saved loan in a dialog, with the form a new loan is confirmed in. `account` is the account the select starts on, "" for the loan's own. */
function EditDialog({ loan, account, today, onSaved, onCancel }: { loan: Loan; account: string; today: string; onSaved: () => void; onCancel: () => void }) {
  const ref = useModal();
  return (
    <dialog ref={ref} className="confirm loan-dialog" aria-labelledby="loan-dialog-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="loan-dialog-title">{t("set.loans.edit_loan")}</h2>
      <LoanEditor
        initial={account ? { ...formOfLoan(loan), accountId: account } : formOfLoan(loan)}
        today={today}
        cancelLabel={t("set.loans.cancel")}
        onSave={async (body) => {
          await loanCalls.replace(loan.id, body);
          onSaved();
        }}
        onCancel={onCancel}
      />
    </dialog>
  );
}

/** Whether the viewer can change the loan of a row: a loan they typed in themselves. */
export const changesLoan = (l: LoanRow): boolean => !l.id.startsWith("account:") && !l.typedBy;

/** `say` tells what a change did, in the line under the head of Saldot, which stays when the change hides this drill. */
export function LoanChanges({ id, meta, say }: { id: string; meta: Pick<Meta, "accounts" | "today">; say?: (text: string | null) => void }) {
  const list = useApi<LoansAnswer>("/api/loans");
  const address = usePageAddress();
  const [editing, setEditing] = useState<{ account: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // the loans of a text read in the box, matched to the saved ones in the table that saves them
  const [read, setRead] = useState<LoanDraft[] | null>(null);
  const loans = list.data?.loans ?? [];
  const loan = loans.find((l) => l.id === id) ?? null;

  // the link of a sentence in Lainat (`linkLoan`, `linkAccount`): the editor opens once with that account chosen, and the
  // address forgets the link, so a reload does not open it again
  const askedLoan = address?.search[LOAN_LINK_PARAM.loan];
  const askedAccount = address?.search[LOAN_LINK_PARAM.account] ?? "";
  useEffect(() => {
    if (askedLoan !== id || loan === null || list.data === null) return;
    address?.change({ [LOAN_LINK_PARAM.loan]: undefined, [LOAN_LINK_PARAM.account]: undefined });
    setEditing({ account: linkChoices(meta.accounts, list.data.loans, id).some((c) => c.id === askedAccount) ? askedAccount : "" });
  }, [askedLoan, askedAccount, id, loan, list.data, meta.accounts, address]);

  if (loan === null) return list.error === null ? null : <Notice tone="error">{list.error}</Notice>;

  const remove = async () => {
    setBusy(true);
    try {
      await loanCalls.remove(loan.id);
      say?.(t("set.loans.loan_removed"));
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
      setRemoving(false);
    }
  };

  return (
    <LoanLinks.Provider value={{ accounts: meta.accounts, loans, fixings: list.data?.fixings }}>
      <div className="loan-wi">
        <div className="form-row">
          <Button onClick={() => setEditing({ account: "" })} aria-label={t("set.loans.edit_loan_name", { name: loan.name })}>
            {t("set.loans.edit")}
          </Button>
          <Button onClick={() => setRemoving(true)} aria-label={t("set.loans.remove_loan_name", { name: loan.name })}>
            {t("set.loans.remove_loan")}
          </Button>
        </div>
        {problem && <Notice tone="error">{problem}</Notice>}
        {read ? (
          <LoanDraftTable drafts={read} loans={loans} today={meta.today} onSaved={() => say?.(t("set.loans.changes_saved"))} onClose={() => setRead(null)} />
        ) : (
          <LoanSource today={meta.today} onDrafts={setRead} />
        )}
      </div>
      {editing && (
        <EditDialog
          loan={loan}
          account={editing.account}
          today={meta.today}
          onSaved={() => {
            setEditing(null);
            say?.(t("set.loans.changes_saved"));
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {removing && (
        <ConfirmDialog title={t("set.loans.remove_name", { name: loan.name })} confirmLabel={t("set.loans.remove_loan")} busy={busy} onConfirm={() => void remove()} onCancel={() => setRemoving(false)}>
          <p>{t("set.loans.the_loan_is_removed_from")}</p>
        </ConfirmDialog>
      )}
    </LoanLinks.Provider>
  );
}
