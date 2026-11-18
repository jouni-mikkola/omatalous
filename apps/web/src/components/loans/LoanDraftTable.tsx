import type { Loan, LoanDraft } from "@banking/core";
import { useState } from "react";
import { loanCalls } from "../../api.ts";
import { money, parseEuros } from "../../format.ts";
import { t } from "../../text.ts";
import { Table } from "../table/Table.tsx";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { useModal } from "../useModal.ts";
import { checksLeft, emptyForm, formOfDraft, formOfLoan, interestOverPayment, type LoanBody, type LoanForm, matchedLoan, readForm } from "./form.ts";
import { FIELD_LABEL, KIND_LABEL, type LoanFieldKey } from "./labels.ts";
import { LoanEditor } from "./LoanEditor.tsx";

interface Row {
  draft: LoanDraft;
  form: LoanForm;
  /** The saved loan this row updates, "" for a new loan. */
  matchId: string;
}

/** The form of a draft read into the saved loan, or into an empty form. */
const rowOf = (draft: LoanDraft, today: string, saved: Loan | null): Row => ({ draft, form: formOfDraft(draft, today, saved ? formOfLoan(saved) : emptyForm(today)), matchId: saved?.id ?? "" });

/** The loan to send, or null while a field is to check, cannot be read or holds a payment below the interest. */
const bodyOf = (row: Row): LoanBody | null => (checksLeft(row.form).length === 0 && interestOverPayment(row.form) === null ? readForm(row.form).body : null);

/** The form of a loan the household confirmed in its dialog: the same loan with no mark left. */
const confirmedForm = (row: Row, body: LoanBody): LoanForm => ({ ...formOfLoan({ ...body, id: "" }), id: row.form.id });

/** What a row still asks of the household, in one line. */
const leftOf = (row: Row): string => {
  if (bodyOf(row)) return t("set.ln.ready");
  return [...checksLeft(row.form).map((key) => FIELD_LABEL[key]), ...Object.values(readForm(row.form).errors)].join(", ");
};

/** One saved loan of the dialog that checks a row: the form of the row, whose Valmis keeps the loan in the table. */
function CheckDialog({ row, today, onReady, onCancel }: { row: Row; today: string; onReady: (body: LoanBody) => void; onCancel: () => void }) {
  const ref = useModal();
  return (
    <dialog ref={ref} className="confirm loan-dialog" aria-labelledby="loan-check-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="loan-check-title">{t("set.ln.check_the_loan")}</h2>
      <LoanEditor initial={row.form} today={today} noSource saveLabel={t("set.ln.ready")} cancelLabel={t("set.loans.cancel")} onSave={async (body) => onReady(body)} onCancel={onCancel} />
    </dialog>
  );
}

/**
 * The loans a text holds, one row each, with the saved loan each one updates (the same series, or the same lender and
 * granted amount) or "Uusi laina". A row is ready when none of its fields is to check; Tarkista opens its form. One
 * Tallenna saves every row. Nothing is saved while a row is not ready.
 */
export function LoanDraftTable({ drafts, loans, today, onSaved, onClose }: {
  drafts: readonly LoanDraft[];
  loans: readonly Loan[];
  today: string;
  /** Some loans are saved: the list reloads and tells how many. */
  onSaved: (count: number) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => {
    const taken = new Set<string>();
    return drafts.map((draft) => {
      const found = matchedLoan(formOfDraft(draft, today), loans);
      const saved = found && !taken.has(found.id) ? found : null;
      if (saved) taken.add(saved.id);
      return rowOf(draft, today, saved);
    });
  });
  const [checking, setChecking] = useState<Row | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amountOf = (row: Row, key: LoanFieldKey) => amount(row.form.values[key]);
  const nameOf = (row: Row) => row.form.values.lender || t("set.ln.loan_n", { n: rows.indexOf(row) + 1 });
  const amount = (text: string) => {
    const cents = parseEuros(text.trim());
    return cents === null ? "–" : money(cents);
  };

  const pick = (row: Row, matchId: string) => setRows((all) => all.map((r) => (r === row ? rowOf(row.draft, today, loans.find((l) => l.id === matchId) ?? null) : r)));

  const save = async () => {
    const bodies = rows.map(bodyOf);
    if (bodies.some((b) => b === null)) return setProblem(t("set.ln.check_every_loan"));
    const used = rows.map((r) => r.matchId).filter(Boolean);
    if (new Set(used).size < used.length) return setProblem(t("set.ln.same_loan_twice"));
    setBusy(true);
    setProblem(null);
    let done = 0;
    try {
      for (const [i, row] of rows.entries()) {
        if (row.matchId) await loanCalls.replace(row.matchId, bodies[i]!);
        else await loanCalls.add(bodies[i]!);
        done++;
      }
      onSaved(done);
      onClose();
    } catch (err) {
      // the rows that are saved leave the table, and the one the server refused stays with its message
      if (done > 0) onSaved(done);
      setRows((all) => all.slice(done));
      setProblem((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="loan-form">
      <Table
        caption={t("set.ln.read_loans")}
        rows={rows}
        rowKey={(row) => String(rows.indexOf(row))}
        columns={[
          {
            key: "loan",
            label: t("set.loans.loan"),
            kind: "text",
            rowHead: true,
            cell: (row) => (
              <>
                {nameOf(row)}
                {row.form.kind !== "" && <div className="sub">{KIND_LABEL[row.form.kind]}</div>}
              </>
            ),
          },
          { key: "balance", label: t("set.loans.remaining"), kind: "money", main: true, cell: (row) => amount(row.form.values.balanceCents) },
          { key: "rate", label: t("set.loans.rate"), kind: "count", cell: (row) => (row.form.values.rateBp === "" ? "–" : `${row.form.values.rateBp} %`) },
          { key: "payment", label: t("set.loans.payment"), kind: "count", cell: (row) => amountOf(row, "paymentCents") },
          {
            key: "match",
            label: t("set.ln.save_as"),
            kind: "text",
            cell: (row) => (
              <select value={row.matchId} aria-label={t("set.ln.save_as_for", { name: nameOf(row) })} onChange={(e) => pick(row, e.target.value)} disabled={busy}>
                <option value="">{t("set.ln.new_loan")}</option>
                {loans.map((loan) => (
                  <option key={loan.id} value={loan.id}>
                    {loan.name}
                  </option>
                ))}
              </select>
            ),
          },
          { key: "left", label: t("set.ln.to_check"), kind: "text", cell: leftOf },
          {
            key: "actions",
            label: t("set.loans.actions"),
            headHidden: true,
            kind: "count",
            cell: (row) => (
              <Button variant="link" disabled={busy} onClick={() => setChecking(row)} aria-label={t("set.ln.check_loan_name", { name: nameOf(row) })}>
                {t("set.ln.mark_check")}
              </Button>
            ),
          },
        ]}
      />
      {problem && <Notice tone="error">{problem}</Notice>}
      <div className="form-row">
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          {rows.length === 1 ? t("set.ln.save_one") : t("set.ln.save_many", { count: rows.length })}
        </Button>
        <Button disabled={busy} onClick={onClose}>
          {t("set.loans.cancel")}
        </Button>
      </div>
      {checking && (
        <CheckDialog
          row={checking}
          today={today}
          onReady={(body) => {
            setRows((all) => all.map((r) => (r === checking ? { ...r, form: confirmedForm(r, body) } : r)));
            setChecking(null);
          }}
          onCancel={() => setChecking(null)}
        />
      )}
    </div>
  );
}
