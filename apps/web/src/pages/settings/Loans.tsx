import { DEBT_ACCOUNT_TYPES, type Loan } from "@banking/core";
import { useEffect, useRef, useState } from "react";
import { loanCalls } from "../../api.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Table } from "../../components/table/Table.tsx";
import { emptyForm, formOfLoan, formOfProposal, LOAN_LINK_PARAM, linkChoices } from "../../components/loans/form.ts";
import { KIND_LABEL } from "../../components/loans/labels.ts";
import { LoanEditor, LoanLinks } from "../../components/loans/LoanEditor.tsx";
import { date, money, percent } from "../../format.ts";
import { useApi, useHashRoute } from "../../hooks.ts";
import { hashOf, SETTINGS_ANCHOR } from "../../routes.ts";
import type { LoanProposalRow, Meta } from "../../types.ts";
import "../../styles/loans.css";
import { Button } from "../../components/ui/Button.tsx";
import { useInPlaceForm } from "../../components/ui/in-place-form.ts";
import { useModal } from "../../components/useModal.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import { Empty } from "../../components/ui/Empty.tsx";
import { t } from "../../text.ts";
const rateOf = (loan: Loan) => (loan.rateBp === null ? null : percent(loan.rateBp / 10_000, 2));
/** The payment of an equal-principal loan is the amortisation alone: the list says so. */
const paymentOf = (loan: Loan) => (loan.paymentCents === null ? null : `${money(loan.paymentCents)}${loan.repayment === "equal_principal" ? t("set.loans.plus_interest") : ""}`);

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

/** A loan the bank rows show, in the form it is saved with: the rows fill the lender, the payment and the interval, the household adds the balance and the rate. */
function ProposalDialog({ proposal, meta, loans, onSaved, onCancel }: { proposal: LoanProposalRow; meta: Meta; loans: readonly Loan[]; onSaved: (name: string) => void; onCancel: () => void }) {
  const ref = useModal();
  return (
    <dialog ref={ref} className="confirm loan-dialog" aria-labelledby="loan-proposal-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="loan-proposal-title">{t("set.loans.add_balance_title")}</h2>
      <LoanEditor
        initial={formOfProposal(proposal, meta.today, meta.accounts, loans)}
        today={meta.today}
        cancelLabel={t("set.loans.cancel")}
        onSave={async (body) => {
          await loanCalls.add(body);
          onSaved(body.name);
        }}
        onCancel={onCancel}
      />
    </dialog>
  );
}

/**
 * Decision: the household keeps its loans here, since the bank connection shows accounts and cards only. The list is
 * what was saved (what is owed and on which day, the rate, the payment, the last due date), each row with edit and
 * remove; under it Lisää laina opens the form of a new loan. Under the list stand the payments the bank rows show as a
 * loan's that no saved loan holds (Tunnistettu, saldo puuttuu): Lisää saldo opens the form filled from the rows, Ei ole
 * laina keeps the payee from being proposed again. A member sees and changes only their own loans.
 */
export function Loans({ meta, onLoaded }: { meta: Meta; onLoaded?: () => void }) {
  const list = useApi<{ loans: Loan[] }>("/api/loans");
  const found = useApi<{ proposals: LoanProposalRow[] }>("/api/loans/proposals");
  // the page scrolls to a card below this one only after this one has its height
  const loaded = (list.data !== null || list.error !== null);
  useEffect(() => {
    if (loaded) onLoaded?.();
  }, [loaded, onLoaded]);
  const [editing, setEditing] = useState<{ loan: Loan; account: string } | null>(null);
  const { open: adding, setOpen: setAdding, region } = useInPlaceForm();
  const [removing, setRemoving] = useState<Loan | null>(null);
  const [proposing, setProposing] = useState<LoanProposalRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "warning"; text: string } | null>(null);
  const loans = list.data?.loans ?? [];
  const proposals = found.data?.proposals ?? [];
  // the account a loan is linked to, while it is one of the household's own cards or loan accounts
  const linkedTo = (loan: Loan) => meta.accounts.find((a) => a.id === loan.accountId && DEBT_ACCOUNT_TYPES.includes(a.type));

  // the Lainat report offers the link (#/settings/household?linkLoan=<loan>&linkAccount=<account>): the editor opens on that loan
  // with the account chosen, once, and the address is cleaned so that a reload does not open it again
  const route = useHashRoute();
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const id = route.page.startsWith("settings/") ? route.params.get(LOAN_LINK_PARAM.loan) : null;
    if (!id || !list.data || opened.current === id) return;
    opened.current = id;
    const params = new URLSearchParams(route.params);
    const account = params.get(LOAN_LINK_PARAM.account) ?? "";
    params.delete(LOAN_LINK_PARAM.loan);
    params.delete(LOAN_LINK_PARAM.account);
    window.history.replaceState(null, "", hashOf({ page: route.page, params, ...(route.anchor ? { anchor: route.anchor } : {}) }));
    const loan = list.data.loans.find((l) => l.id === id);
    if (!loan) return setMessage({ tone: "warning", text: t("set.loans.the_loan_can_no_longer") });
    setEditing({ loan, account: linkChoices(meta.accounts, list.data.loans, loan.id).some((c) => c.id === account) ? account : "" });
  }, [route, list.data, meta.accounts]);

  const done = (text: string) => {
    setMessage({ tone: "good", text });
    list.reload();
    found.reload();
  };

  const notLoan = async (proposal: LoanProposalRow) => {
    setBusy(true);
    try {
      await loanCalls.notLoan(proposal.key);
      done(t("set.loans.marked_not_loan", { name: proposal.payee }));
    } catch (err) {
      setMessage({ tone: "warning", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (loan: Loan) => {
    setBusy(true);
    try {
      await loanCalls.remove(loan.id);
      done(t("set.loans.loan_removed"));
    } catch (err) {
      setMessage({ tone: "warning", text: (err as Error).message });
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  const card = (
    <div className="card" id={SETTINGS_ANCHOR.loans} {...region}>
      <div className="card-head">
        <h2>{t("set.loans.loans")}</h2>
        {/* the section's one action stands in its name strip, in the same place in every section */}
        {!adding && (
          <div className="form-row flush">
            <Button data-opener onClick={() => setAdding(true)}>{t("set.loans.add_loan")}</Button>
          </div>
        )}
      </div>
      {message && (
        <Notice tone={message.tone} role="status">
          {message.text}
        </Notice>
      )}
      {loans.length > 0 && (
        <Table
          caption={t("set.loans.loans")}
          rows={loans}
          rowKey={(loan) => loan.id}
          columns={[
            {
              key: "name",
              label: t("set.loans.loan"),
              kind: "text",
              rowHead: true,
              cell: (loan) => (
                <>
                  {loan.name}
                  <div className="sub">{KIND_LABEL[loan.kind]}</div>
                  {linkedTo(loan) && <div className="sub">{t("set.loans.linked_to_account_name", { name: linkedTo(loan)!.name })}</div>}
                </>
              ),
            },
            { key: "lender", label: t("set.loans.lender"), kind: "text", cell: (loan) => loan.lender ?? "–" },
            {
              key: "balance",
              label: t("set.loans.remaining"),
              kind: "money",
              main: true,
              cell: (loan) => (
                <>
                  {money(loan.balanceCents)}
                  <div className="sub">{linkedTo(loan) ? t("set.loans.recorded", { date: date(loan.balanceDate) }) : date(loan.balanceDate)}</div>
                </>
              ),
            },
            { key: "rate", label: t("set.loans.rate"), kind: "count", cell: (loan) => rateOf(loan) ?? "–" },
            { key: "payment", label: t("set.loans.payment"), kind: "count", cell: (loan) => paymentOf(loan) ?? "–" },
            { key: "end", label: t("set.loans.last_due_date"), kind: "date", cell: (loan) => date(loan.endDate) },
            {
              key: "actions",
              label: t("set.loans.actions"),
              headHidden: true,
              kind: "count",
              cell: (loan) => (
                <span className="row-actions">
                  <Button variant="link" onClick={() => setEditing({ loan, account: "" })} aria-label={t("set.loans.edit_loan_name", { name: loan.name })}>
                    {t("set.loans.edit")}
                  </Button>
                  <Button variant="link" onClick={() => setRemoving(loan)} aria-label={t("set.loans.remove_loan_name", { name: loan.name })}>
                    {t("set.loans.remove")}
                  </Button>
                </span>
              ),
            },
          ]}
        />
      )}
      {list.error && <Notice tone="error">{list.error}</Notice>}
      {/* while the lists are on their way the line keeps its room, so the cards below do not move when they arrive */}
      {loans.length === 0 && proposals.length === 0 && !list.error && (
        <Empty className={list.data && found.data ? undefined : "loans-wait"}>{t("set.loans.no_loans")}</Empty>
      )}
      {proposals.length > 0 && (
        <section className="loan-found" aria-labelledby="loan-found-title">
          <h3 id="loan-found-title">{t("set.loans.found_title")}</h3>
          <p className="small muted">{t("set.loans.found_help")}</p>
          <Table
            caption={t("set.loans.found_title")}
            rows={proposals}
            rowKey={(proposal) => proposal.key}
            columns={[
              { key: "payee", label: t("set.loans.found_payee"), kind: "text", rowHead: true, cell: (proposal) => proposal.payee },
              { key: "payment", label: t("set.loans.found_payment"), kind: "money", main: true, cell: (proposal) => money(proposal.paymentCents) },
              { key: "months", label: t("set.loans.found_months"), kind: "count", cell: (proposal) => proposal.months },
              {
                key: "actions",
                label: t("set.loans.actions"),
                headHidden: true,
                kind: "count",
                cell: (proposal) => (
                  <span className="row-actions">
                    <Button variant="link" onClick={() => setProposing(proposal)} aria-label={t("set.loans.add_balance_name", { name: proposal.payee })}>
                      {t("set.loans.add_balance")}
                    </Button>
                    <Button variant="link" disabled={busy} onClick={() => void notLoan(proposal)} aria-label={t("set.loans.not_a_loan_name", { name: proposal.payee })}>
                      {t("set.rc.not_a_loan")}
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        </section>
      )}
      {found.error && <Notice tone="error">{found.error}</Notice>}

      {adding && (
        <section className="loan-draft" aria-labelledby="loan-new-title">
          <h3 id="loan-new-title">{t("set.loans.new_loan")}</h3>
          <LoanEditor
            initial={emptyForm(meta.today)}
            today={meta.today}
            cancelLabel={t("set.loans.cancel")}
            onSave={async (body) => {
              await loanCalls.add(body);
              setAdding(false);
              done(`${body.name} tallennettu.`);
            }}
            onCancel={() => setAdding(false)}
          />
        </section>
      )}

      {editing && (
        <EditDialog
          key={editing.loan.id}
          loan={editing.loan}
          account={editing.account}
          today={meta.today}
          onSaved={() => {
            setEditing(null);
            done(t("set.loans.changes_saved"));
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {proposing && (
        <ProposalDialog
          key={proposing.key}
          proposal={proposing}
          meta={meta}
          loans={loans}
          onSaved={(name) => {
            setProposing(null);
            done(`${name} tallennettu.`);
          }}
          onCancel={() => setProposing(null)}
        />
      )}
      {removing && (
        <ConfirmDialog title={t("set.loans.remove_name", { name: removing.name })} confirmLabel={t("set.loans.remove_loan")} busy={busy} onConfirm={() => void remove(removing)} onCancel={() => setRemoving(null)}>
          <p>{t("set.loans.the_loan_is_removed_from")}</p>
        </ConfirmDialog>
      )}
    </div>
  );
  return <LoanLinks.Provider value={{ accounts: meta.accounts, loans }}>{card}</LoanLinks.Provider>;
}
