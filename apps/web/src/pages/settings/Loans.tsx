import { DEBT_ACCOUNT_TYPES, type Loan } from "@banking/core";
import { useEffect, useRef, useState } from "react";
import { loanCalls } from "../../api.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { formOfLoan, LOAN_LINK_PARAM, linkChoices } from "../../components/loans/form.ts";
import { KIND_LABEL } from "../../components/loans/labels.ts";
import { LoanEditor, LoanLinks } from "../../components/loans/LoanEditor.tsx";
import { Proposals } from "../../components/loans/Proposals.tsx";
import { date, money, percent } from "../../format.ts";
import { useApi, useHashRoute } from "../../hooks.ts";
import { hashOf, SETTINGS_ANCHOR } from "../../routes.ts";
import type { LoanProposalRow, Meta } from "../../types.ts";
import { LoanIntake } from "./LoanIntake.tsx";
import "../../styles/loans.css";

const rateOf = (loan: Loan) => (loan.rateBp === null ? null : percent(loan.rateBp / 10_000, 2));
/** The payment of an equal-principal loan is the amortisation alone: the list says so. */
const paymentOf = (loan: Loan) => (loan.paymentCents === null ? null : `${money(loan.paymentCents)}${loan.repayment === "equal_principal" ? " + korko" : ""}`);

/** A saved loan in a dialog, with the form a new loan is confirmed in. `account` is the account the select starts on, "" for the loan's own. */
function EditDialog({ loan, account, today, onSaved, onCancel }: { loan: Loan; account: string; today: string; onSaved: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} className="confirm loan-dialog" aria-labelledby="loan-dialog-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="loan-dialog-title">Muokkaa lainaa</h2>
      <LoanEditor
        initial={account ? { ...formOfLoan(loan), accountId: account } : formOfLoan(loan)}
        today={today}
        cancelLabel="Peruuta"
        onSave={async (body) => {
          await loanCalls.replace(loan.id, body);
          onSaved();
        }}
        onCancel={onCancel}
      />
    </dialog>
  );
}

/**
 * Decision: the household keeps its loans here, since the bank connection shows accounts and cards only. The list is
 * what was saved (what is owed and on which day, the rate, the payment, the last due date), each row with edit and
 * remove; under it is the box a new loan is pasted into. A member sees and changes only their own loans.
 */
export function Loans({ meta, onLoaded }: { meta: Meta; onLoaded?: () => void }) {
  const list = useApi<{ loans: Loan[] }>("/api/loans");
  // the loans the bank rows show and nobody has answered: worked out for each request, so every answer reloads them
  const proposed = useApi<{ proposals: LoanProposalRow[] }>("/api/loans/proposals");
  // the page scrolls to a card below this one only after this one has its height
  const loaded = (list.data !== null || list.error !== null) && (proposed.data !== null || proposed.error !== null);
  useEffect(() => {
    if (loaded) onLoaded?.();
  }, [loaded, onLoaded]);
  const [editing, setEditing] = useState<{ loan: Loan; account: string } | null>(null);
  const [removing, setRemoving] = useState<Loan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "warning"; text: string } | null>(null);
  const loans = list.data?.loans ?? [];
  // the account a loan is linked to, while it is one of the household's own cards or loan accounts
  const linkedTo = (loan: Loan) => meta.accounts.find((a) => a.id === loan.accountId && DEBT_ACCOUNT_TYPES.includes(a.type));

  // the Lainat report offers the link (#/settings?linkLoan=<loan>&linkAccount=<account>): the editor opens on that loan
  // with the account chosen, once, and the address is cleaned so that a reload does not open it again
  const route = useHashRoute(meta.user.role);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const id = route.page === "settings" ? route.params.get(LOAN_LINK_PARAM.loan) : null;
    if (!id || !list.data || opened.current === id) return;
    opened.current = id;
    const params = new URLSearchParams(route.params);
    const account = params.get(LOAN_LINK_PARAM.account) ?? "";
    params.delete(LOAN_LINK_PARAM.loan);
    params.delete(LOAN_LINK_PARAM.account);
    window.history.replaceState(null, "", hashOf({ page: "settings", params, ...(route.anchor ? { anchor: route.anchor } : {}) }));
    const loan = list.data.loans.find((l) => l.id === id);
    if (!loan) return setMessage({ tone: "warning", text: "Lainaa ei löydy enää." });
    setEditing({ loan, account: linkChoices(meta.accounts, list.data.loans, loan.id).some((c) => c.id === account) ? account : "" });
  }, [route, list.data, meta.accounts]);

  const done = (text: string) => {
    setMessage({ tone: "good", text });
    list.reload();
    proposed.reload();
  };

  const remove = async (loan: Loan) => {
    setBusy(true);
    try {
      await loanCalls.remove(loan.id);
      done("Laina poistettu.");
    } catch (err) {
      setMessage({ tone: "warning", text: (err as Error).message });
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  const card = (
    <div className="card" id={SETTINGS_ANCHOR.loans}>
      <div className="card-head">
        <div>
          <h2>Lainat</h2>
          <div className="card-sub">Pankkiyhteys näyttää vain tilit ja kortit, joten lainat lisätään tässä.</div>
        </div>
      </div>
      {message && (
        <div className={`notice ${message.tone}`} role="status">
          {message.text}
        </div>
      )}
      <Proposals proposals={proposed.data?.proposals ?? []} today={meta.today} onAnswered={done} />
      {loans.length > 0 && (
        <div className="table-wrap">
          <table className="loans-table">
            <thead>
              <tr>
                <th>Laina</th>
                <th className="hide-phone">Lainanantaja</th>
                <th className="num">Jäljellä</th>
                <th className="num hide-phone">Korko</th>
                <th className="num hide-phone">Maksuerä</th>
                <th className="hide-phone">Viimeinen eräpäivä</th>
                <th>
                  <span className="sr-only">Toiminnot</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => (
                <tr key={loan.id}>
                  <td>
                    {loan.name}
                    <div className="sub">{KIND_LABEL[loan.kind]}</div>
                    {linkedTo(loan) && <div className="sub">{`Liitetty tiliin ${linkedTo(loan)!.name}. Velkana käytetään pankin saldoa, kun pankki ilmoittaa sen.`}</div>}
                    <div className="sub loan-phone">{[loan.lender, rateOf(loan), paymentOf(loan), loan.endDate && `viimeinen eräpäivä ${date(loan.endDate)}`].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="hide-phone">{loan.lender ?? "–"}</td>
                  <td className="num">
                    {money(loan.balanceCents)}
                    <div className="sub">{linkedTo(loan) ? `kirjattu ${date(loan.balanceDate)}` : date(loan.balanceDate)}</div>
                  </td>
                  <td className="num hide-phone">{rateOf(loan) ?? "–"}</td>
                  <td className="num hide-phone">{paymentOf(loan) ?? "–"}</td>
                  <td className="hide-phone">{date(loan.endDate)}</td>
                  <td className="num">
                    <span className="row-actions">
                      <button className="btn btn-small" type="button" onClick={() => setEditing({ loan, account: "" })} aria-label={`Muokkaa lainaa ${loan.name}`}>
                        Muokkaa
                      </button>
                      <button className="btn btn-small btn-danger" type="button" onClick={() => setRemoving(loan)} aria-label={`Poista laina ${loan.name}`}>
                        Poista
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.error && <div className="error">{list.error}</div>}
      {/* while the list is on its way the line keeps its room, so the cards below do not move when it arrives */}
      {loans.length === 0 && !list.error && (
        <div className={`empty${list.data ? "" : " loans-wait"}`}>
          Ei lainoja vielä. Liitä alle kuva tai teksti lainasta.
        </div>
      )}

      <LoanIntake today={meta.today} onSaved={(name) => done(`${name} tallennettu.`)} />

      {editing && (
        <EditDialog
          key={editing.loan.id}
          loan={editing.loan}
          account={editing.account}
          today={meta.today}
          onSaved={() => {
            setEditing(null);
            done("Muutokset tallennettu.");
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {removing && (
        <ConfirmDialog title="Poistetaanko laina?" confirmLabel="Poista" busy={busy} onConfirm={() => void remove(removing)} onCancel={() => setRemoving(null)}>
          <p>{removing.name} poistuu luvuista. Tapahtumat pysyvät ennallaan.</p>
        </ConfirmDialog>
      )}
    </div>
  );
  return <LoanLinks.Provider value={{ accounts: meta.accounts, loans }}>{card}</LoanLinks.Provider>;
}
