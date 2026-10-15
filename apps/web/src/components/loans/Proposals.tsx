import { useContext, useState } from "react";
import { loanCalls } from "../../api.ts";
import { money } from "../../format.ts";
import type { LoanProposalRow } from "../../types.ts";
import { formOfProposal } from "./form.ts";
import { LoanEditor, LoanLinks } from "./LoanEditor.tsx";

/**
 * Decision: the household answers once for each monthly payment the bank rows show and nobody has explained: this is a
 * loan (and the balance is typed in), or this is no loan. A payee can be a bank, a finance company, a private person
 * or a housing company, so the question is the one a neighbour would ask and "Ei laina" is an easy answer. Nothing is
 * shown while there is nothing to ask.
 */
export const PROPOSALS_TITLE = "Mahdolliset lainat";
export const PROPOSAL_QUESTION = "Onko tämä lainan maksu?";
export const HELP_RATE = "Lisää vielä lainan korko.";
export const HELP_BALANCE_AND_RATE = "Lisää vielä jäljellä oleva laina ja korko.";
/** The help asks only for what the proposal's form leaves empty: the balance is filled when the loan account tells it. */
export const editorHelp = (form: { values: { balanceCents: string } }): string => (form.values.balanceCents === "" ? HELP_BALANCE_AND_RATE : HELP_RATE);

/** The monthly payment, as the phone's second line says it. */
export const monthlyText = (proposal: Pick<LoanProposalRow, "paymentCents">): string => `${money(proposal.paymentCents)} kuukaudessa`;
/** What the page tells after "Ei laina". */
export const notLoanText = (proposal: Pick<LoanProposalRow, "payee">): string => `Merkitty: ${proposal.payee} ei ole laina.`;

/**
 * The block above the saved loans. "Tallenna lainaksi" opens the loan form under the row with what the rows show
 * filled in; the balance and the rate are left to the household, except the balance of the one loan account no saved loan holds. "Ei laina" sets the mark. `onAnswered` reloads the
 * page's lists, so the answered row goes.
 */
export function Proposals({ proposals, today, onAnswered }: { proposals: readonly LoanProposalRow[]; today: string; onAnswered: (text: string) => void }) {
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (proposals.length === 0) return null;

  const notLoan = async (proposal: LoanProposalRow) => {
    setBusy(proposal.key);
    setProblem(null);
    try {
      await loanCalls.notLoan(proposal.key);
      onAnswered(notLoanText(proposal));
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="loan-proposals">
      <h3 className="subhead">{PROPOSALS_TITLE}</h3>
      {problem && (
        <div className="notice warning" role="alert">
          {problem}
        </div>
      )}
      <div className="table-wrap">
        <table className="loans-table">
          <thead>
            <tr>
              <th>Saaja</th>
              <th className="num hide-phone">Maksuerä</th>
              <th className="num">{PROPOSAL_QUESTION}</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <ProposalRow
                key={proposal.key}
                proposal={proposal}
                today={today}
                open={opened === proposal.key}
                busy={busy !== null}
                waiting={busy === proposal.key}
                onOpen={() => setOpened(proposal.key)}
                onClose={() => setOpened(null)}
                onNotLoan={() => void notLoan(proposal)}
                onSaved={(name) => {
                  setOpened(null);
                  onAnswered(`${name} tallennettu.`);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProposalRow({ proposal, today, open, busy, waiting, onOpen, onClose, onNotLoan, onSaved }: {
  proposal: LoanProposalRow;
  today: string;
  open: boolean;
  busy: boolean;
  /** This row's own "Ei laina" is on its way. */
  waiting: boolean;
  onOpen: () => void;
  onClose: () => void;
  onNotLoan: () => void;
  onSaved: (name: string) => void;
}) {
  const links = useContext(LoanLinks);
  const initial = formOfProposal(proposal, today, links.accounts, links.loans);
  return (
    <>
      <tr>
        <td>
          {proposal.payee}
          <div className="sub loan-phone">{monthlyText(proposal)}</div>
        </td>
        <td className="num hide-phone">{money(proposal.paymentCents)}</td>
        <td className="num">
          <span className="row-actions">
            <button className="btn btn-small" type="button" disabled={open} onClick={onOpen} aria-label={`Tallenna lainaksi: ${proposal.payee}`}>
              Tallenna lainaksi
            </button>
            <button className="btn btn-small" type="button" disabled={busy} aria-busy={waiting || undefined} onClick={onNotLoan} aria-label={`Ei laina: ${proposal.payee}`}>
              Ei laina
            </button>
          </span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={3}>
            <section className="loan-draft" aria-label={`Tallenna laina: ${proposal.payee}`}>
              <h3>Tallenna laina: {proposal.payee}</h3>
              <p className="small muted">{editorHelp(initial)}</p>
              <LoanEditor
                initial={initial}
                today={today}
                cancelLabel="Peruuta"
                onSave={async (body) => {
                  await loanCalls.add(body);
                  onSaved(body.name);
                }}
                onCancel={onClose}
              />
            </section>
          </td>
        </tr>
      )}
    </>
  );
}
