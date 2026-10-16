// Decision: "Miksi?" opens the rows of a figure in a panel; the names come from the list the page already reads
import { type Explanation, type FigureId, type Reason, sentenceOf } from "@banking/core";
import { useEffect, useRef, useState } from "react";
import { query } from "../api.ts";
import { dayMonth, money } from "../format.ts";
import { useApi } from "../hooks.ts";
import type { Meta, Scope, TransactionItem } from "../types.ts";
import "../styles/why.css";

/** The rows shown before "Näytä kaikki". */
const FIRST_ROWS = 50;

interface WhyFigure {
  figure: Extract<FigureId, "spend.month" | "spend.category" | "income.month" | "income.earned">;
  /** The name of the figure, as its row says it. */
  title: string;
  range: { from: string; to: string };
  scope: Scope;
  accounts?: readonly string[];
  category?: string;
}

/** "Täsmää", or the difference when the rows do not add up to the figure: a difference is never left out. */
function checkText(check: Explanation["check"]): string {
  return check.kind === "n/a" || check.diffCents === 0 ? "Täsmää" : `Ero ${money(check.diffCents)}`;
}

type Line = Explanation["lines"][number];

/** The one reason a row says, first in this order; the app's own category rule is what nearly every row has, so it says nothing (the category name stands alone). */
const ORDER = [
  "transfer.pair",
  "transfer.channel",
  "card.bill",
  "return.shop",
  "return.person",
  "return.share",
  "refund.net",
  "part.use",
  "category.hand",
  "category.own_rule",
] as const;
function reasonOf(why: readonly Reason[]): string | undefined {
  for (const rule of ORDER) {
    const r = why.find((x) => x.rule === rule);
    if (r) return sentenceOf(r);
  }
  return undefined;
}

/** The button that opens the panel of one figure. */
export function Why(props: WhyFigure) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="why-open" aria-haspopup="dialog" aria-label={`Miksi? ${props.title}`} onClick={() => setOpen(true)}>
        Miksi?
      </button>
      {open && <WhyPanel {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function WhyPanel({ figure, title, range, scope, accounts, category, onClose }: WhyFigure & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  const why = useApi<Explanation>(`/api/explain${query({ figure, ...range, scope, accounts: accounts?.join(","), category })}`);
  // the answer holds ids only: a row is named by the list of rows the page reads for the same days
  const rows = useApi<{ items: TransactionItem[] }>(`/api/transactions${query({ ...range, scope, limit: 5000 })}`);
  const meta = useApi<Pick<Meta, "categories">>("/api/meta");
  const names = new Map((rows.data?.items ?? []).map((t) => [t.id, t]));
  const labels = new Map((meta.data?.categories ?? []).map((c) => [c.id, c.label]));
  const e = why.data;
  // a row the figure left out counts nothing: it stands in the closed group at the foot, never between the counted rows
  const counted = e ? e.lines.filter((l) => l.cents !== 0) : [];
  const left = e ? e.lines.filter((l) => l.cents === 0) : [];
  const shownRows = all ? counted : counted.slice(0, FIRST_ROWS);
  const row = (l: Line, key: string, withCategory: boolean) => {
    const t = names.get(l.id);
    const category = withCategory && t ? labels.get(t.category) ?? t.category : undefined;
    const reason = reasonOf(l.why);
    return [
      <tr key={key} {...{ [withCategory ? "data-why-row" : "data-why-left"]: l.id }}>
        <td>{dayMonth(l.day)}</td>
        <td>{t?.merchant ?? "–"}</td>
        <td className="num">{money(l.cents)}</td>
      </tr>,
      ...(category || reason || l.whole !== undefined
        ? [
            <tr key={`${key}-why`} className="why-more">
              <td colSpan={3}>
                {category && <div>{category}</div>}
                {reason && <div className="why-reason">{reason}</div>}
                {l.whole !== undefined && <div className="why-reason">Pankin summa {money(l.whole)}</div>}
              </td>
            </tr>,
          ]
        : []),
    ];
  };
  const head = (
    <thead>
      <tr>
        <th scope="col">Päivä</th>
        <th scope="col">Saaja</th>
        <th scope="col" className="num">
          Summa
        </th>
      </tr>
    </thead>
  );
  return (
    <dialog
      ref={ref}
      className="why"
      aria-labelledby="why-title"
      onCancel={(ev) => {
        ev.preventDefault();
        onClose();
      }}
    >
      <h2 id="why-title">{title}</h2>
      {why.error && <p role="alert">{why.error}</p>}
      {!e && !why.error && <p role="status">Ladataan…</p>}
      {e && (
        <>
          <div className="why-scroll">
            <table className="why-rows">
              {head}
              <tbody>{shownRows.flatMap((l) => row(l, l.id, true))}</tbody>
            </table>
            {counted.length > FIRST_ROWS && !all && (
              <button type="button" className="btn btn-small" onClick={() => setAll(true)}>
                Näytä kaikki
              </button>
            )}
            {left.length > 0 && (
              <details className="why-left">
                <summary>{`Ei mukana: ${left.length === 1 ? "1 tapahtuma" : `${left.length} tapahtumaa`}`}</summary>
                <table className="why-rows">
                  {head}
                  <tbody>{left.flatMap((l) => row(l, `left-${l.id}`, false))}</tbody>
                </table>
              </details>
            )}
          </div>
          <div className="why-foot">
            <div className="why-total">
              <span>Yhteensä</span>
              <span className="num" data-why-total>
                {money(e.cents ?? 0)}
              </span>
            </div>
            <p className={e.check.kind === "sum" && e.check.diffCents !== 0 ? "why-check why-differs" : "why-check"} role="status">
              {checkText(e.check)}
            </p>
          </div>
        </>
      )}
      <div className="form-row">
        <button type="button" className="btn" onClick={onClose}>
          Sulje
        </button>
      </div>
    </dialog>
  );
}
