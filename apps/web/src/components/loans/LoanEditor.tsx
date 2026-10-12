import { LOAN_KINDS, LOAN_REFERENCES, LOAN_REPAYMENTS, type Loan, type LoanKind } from "@banking/core";
import { createContext, type FormEvent, type ReactNode, useContext, useId, useState } from "react";
import { money } from "../../format.ts";
import type { Account } from "../../types.ts";
import { checksLeft, defaultName, type FormErrors, interestOverPayment, type LoanBody, type LoanForm, linkChoices, markOf, readForm, setKind, setValue, shownFields, toggleConfirmed, warningsOf } from "./form.ts";
import { FIELD_LABEL, INTERVALS, intervalLabel, KIND_LABEL, type LoanFieldKey, REFERENCE_LABEL, REPAYMENT_LABEL } from "./labels.ts";

const UNIT: Partial<Record<LoanFieldKey, string>> = { balanceCents: "€", grantedCents: "€", limitCents: "€", paymentCents: "€", rateBp: "%", marginBp: "%" };

/**
 * What the select "Sama velka pankin tilillä" offers from: the household's accounts and its saved loans (an account
 * another loan holds is not offered). The loans card provides it to every form it holds, so the intake and the
 * proposals need no props for it. Without a provider the select is not shown.
 */
export const LoanLinks = createContext<{ accounts: readonly Account[]; loans: readonly Loan[] }>({ accounts: [], loans: [] });

const LINK_HELP = "Kun laina on liitetty tiliin, velka lasketaan vain kerran ja saldo tulee pankista.";
/** Under the balance of a linked loan: the bank's balance counts while the bank tells one, and the typed one otherwise. */
const LINKED_BALANCE_HELP = "Velkana käytetään pankin saldoa aina, kun pankki ilmoittaa sen. Muulloin käytetään tähän kirjattua saldoa.";
const REVIEW_HELP = "Päivä, jona pankki seuraavan kerran tarkistaa viitekoron. Näkyy lainasopimuksessa ja verkkopankissa.";

/** What the payment figure is, by the way the loan is paid back. */
function paymentHelp(form: LoanForm): string | null {
  const read = form.source?.payment;
  if (form.paymentKind === "amortisation" && form.values.paymentCents === "" && read) return `Tekstissä oli pelkkä lyhennys (${read} €). Kirjoita koko maksuerä tai jätä kenttä tyhjäksi.`;
  if (form.values.repayment === "equal_principal") return "Pelkkä lyhennys. Korko maksetaan sen lisäksi.";
  if (form.values.repayment === "annuity" || form.values.repayment === "fixed_instalment") return "Koko erä, korko mukana.";
  return form.paymentKind === "amortisation" ? "Tekstistä luettiin pelkkä lyhennys." : null;
}

/**
 * The form of one loan: a draft read from a text or a picture, a loan typed in, or a saved loan. A draft shows under
 * each field the line it was read from and how sure the reading is, and a field to check must be ticked or changed
 * before the loan can be saved. Nothing is sent before Tallenna.
 */
export function LoanEditor({ initial, today, cancelLabel, onSave, onCancel }: {
  initial: LoanForm;
  /** The instance's day: the latest day a balance can be of. */
  today: string;
  cancelLabel: string;
  onSave: (body: LoanBody) => Promise<void>;
  onCancel: () => void;
}) {
  const uid = useId();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = shownFields(form);
  const left = checksLeft(form);
  const warnings = warningsOf(form);
  const interest = interestOverPayment(form);
  const links = useContext(LoanLinks);
  const choices = linkChoices(links.accounts, links.loans, form.id);
  // a stored link to an account that is not offered any more (removed, no card or loan account) is not kept by a save
  const linked = choices.some((c) => c.id === form.accountId) ? form.accountId : "";
  const idOf = (key: string) => `${uid}-${key}`;
  const change = (key: LoanFieldKey, text: string) => setForm((f) => setValue(f, key, text));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const { body, errors: found } = readForm({ ...form, accountId: linked });
    setErrors(found);
    const stop = Object.keys(found)[0] ?? left[0] ?? (interest !== null ? "paymentCents" : null);
    if (!body || stop) {
      setProblem(
        Object.keys(found).length > 0
          ? "Korjaa merkityt kentät."
          : left.length > 0
            ? `Tarkista vielä: ${left.map((key) => FIELD_LABEL[key]).join(", ")}. Merkitse kenttä oikeaksi tai korjaa se.`
            : "Maksuerä on pienempi kuin korko. Korjaa luvut tai tyhjennä maksuerä.",
      );
      if (stop) document.getElementById(idOf(stop))?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onSave(body);
    } catch (err) {
      // the server names the field it refused
      setProblem((err as Error).message);
      setBusy(false);
    }
  };

  const input = (key: LoanFieldKey, describedBy: string | undefined): ReactNode => {
    const common = { id: idOf(key), value: form.values[key], "aria-describedby": describedBy, "aria-invalid": errors[key] ? true : undefined };
    const pick = (options: readonly (readonly [string, string])[]) => (
      <select {...common} onChange={(e) => change(key, e.target.value)}>
        <option value="">Ei tiedossa</option>
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    );
    if (key === "reference") return pick(LOAN_REFERENCES.map((id) => [id, REFERENCE_LABEL[id]] as const));
    if (key === "repayment") return pick(LOAN_REPAYMENTS.map((id) => [id, REPAYMENT_LABEL[id]] as const));
    if (key === "intervalMonths") {
      const current = Number(form.values.intervalMonths);
      const months = current > 0 && !INTERVALS.some((m) => m === current) ? [...INTERVALS, current].sort((a, b) => a - b) : INTERVALS;
      return pick(months.map((m) => [String(m), intervalLabel(m)] as const));
    }
    if (key === "balanceDate" || key === "endDate" || key === "rateReviewDate") return <input {...common} type="date" max={key === "balanceDate" ? today : undefined} required={key === "balanceDate"} onChange={(e) => change(key, e.target.value)} />;
    if (key === "lender") return <input {...common} type="text" maxLength={80} autoComplete="off" onChange={(e) => change(key, e.target.value)} />;
    return <input {...common} type="text" inputMode="decimal" autoComplete="off" required={key === "balanceCents"} onChange={(e) => change(key, e.target.value)} />;
  };

  return (
    <form className="loan-form" onSubmit={(e) => void submit(e)} noValidate>
      <div className="loan-fields">
        <div className="loan-field">
          <label className="field-label" htmlFor={idOf("name")}>
            Nimi
          </label>
          <input id={idOf("name")} type="text" maxLength={80} autoComplete="off" value={form.name} placeholder={form.kind === "" ? "" : defaultName(form.kind, form.values.lender)} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <span className="field-help">Tyhjänä nimeksi tulee laji ja lainanantaja.</span>
        </div>
        <div className="loan-field">
          <label className="field-label" htmlFor={idOf("kind")}>
            Laji
          </label>
          <select id={idOf("kind")} value={form.kind} required aria-invalid={errors.kind ? true : undefined} aria-describedby={errors.kind ? idOf("kind-error") : undefined} onChange={(e) => setForm(setKind(form, e.target.value as LoanKind | ""))}>
            <option value="">Valitse laji</option>
            {LOAN_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
          {errors.kind && (
            <span id={idOf("kind-error")} className="error field-error">
              {errors.kind}
            </span>
          )}
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="notice warning loan-warnings">
          {warnings.map((w) => (
            <li key={w.id}>{w.text}</li>
          ))}
        </ul>
      )}

      <div className="loan-fields">
        {shown.map((key) => {
          const mark = markOf(form, key);
          const confirmed = form.confirmed.includes(key);
          const line = form.source?.lines[key];
          const help = key === "paymentCents" ? paymentHelp(form) : key === "balanceDate" && mark === "missing" ? "Tekstissä ei ollut päivää, joten tässä on tämä päivä." : key === "balanceCents" && linked ? LINKED_BALANCE_HELP : key === "rateReviewDate" ? REVIEW_HELP : null;
          const described = [mark && idOf(`${key}-mark`), line && idOf(`${key}-line`), help && idOf(`${key}-help`), errors[key] && idOf(`${key}-error`)].filter(Boolean).join(" ") || undefined;
          return (
            <div key={key} className={`loan-field${mark === "check" && !confirmed ? " to-check" : ""}`}>
              <div className="loan-field-head">
                <label className="field-label" htmlFor={idOf(key)}>
                  {FIELD_LABEL[key]}
                  {UNIT[key] ? ` (${UNIT[key]})` : ""}
                </label>
                {mark && (
                  <span id={idOf(`${key}-mark`)} className={`badge ${mark === "sure" || (mark === "check" && confirmed) ? "good" : mark === "check" ? "warn" : ""}`}>
                    {mark === "sure" ? "Varma" : mark === "missing" ? "Ei löytynyt" : confirmed ? "Tarkistettu" : "Tarkista"}
                  </span>
                )}
              </div>
              {input(key, described)}
              {line && (
                <span id={idOf(`${key}-line`)} className="loan-source">
                  Tekstissä: {line}
                </span>
              )}
              {mark === "check" && (
                <label className="loan-confirm">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setForm(toggleConfirmed(form, key, e.target.checked))} aria-label={`${FIELD_LABEL[key]} on oikein`} />
                  Oikein
                </label>
              )}
              {help && (
                <span id={idOf(`${key}-help`)} className="field-help">
                  {help}
                </span>
              )}
              {errors[key] && (
                <span id={idOf(`${key}-error`)} className="error field-error">
                  {errors[key]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {choices.length > 0 && (
        <div className="loan-field">
          <label className="field-label" htmlFor={idOf("account")}>
            Sama velka pankin tilillä
          </label>
          <select id={idOf("account")} value={linked} aria-describedby={idOf("account-help")} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">Ei liitetty</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span id={idOf("account-help")} className="field-help">
            {LINK_HELP}
          </span>
        </div>
      )}

      {form.values.repayment === "bullet" && shown.includes("repayment") && <p className="small muted loan-note">Kertalyhenteinen laina maksetaan kerralla viimeisenä eräpäivänä, joten sillä ei ole maksuerää.</p>}

      {interest !== null && (
        <div className="notice warning loan-interest" role="status">
          <p>
            Maksuerä on pienempi kuin lyhennysvälin korko ({money(interest)}), joten laina ei lyhenisi. Tarkista luvut, tai jätä maksuerä tyhjäksi, jos maksat vain korkoa.
          </p>
          <button className="btn btn-small" type="button" onClick={() => change("paymentCents", "")}>
            Tyhjennä maksuerä
          </button>
        </div>
      )}

      {problem && (
        <div className="error" role="alert">
          {problem}
        </div>
      )}
      <div className="form-row">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Tallennetaan…" : "Tallenna"}
        </button>
        <button className="btn" type="button" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
        {left.length > 0 && <span className="small muted">Tarkistettavia kenttiä: {left.length}</span>}
      </div>
    </form>
  );
}
