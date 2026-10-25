import { addDays } from "@banking/core";
import { Table } from "../table/Table.tsx";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import { date, eurosText, money, parseEuros, plural } from "../../format.ts";
import { readStatement, type StatementLine } from "./read-statement.ts";
import "../../styles/card-statement.css";

/** One saved statement as /api/statements gives it (only what the page reads). */
export interface SavedStatement {
  billId: string;
  periodFrom: string;
  periodTo: string;
  read: boolean;
  explainedCents: number;
  rows: StatementLine[];
}

export interface BillFacts {
  id: string;
  bookingDate: string;
  amountCents: number;
  merchant: string;
}

const sameRow = (a: StatementLine, b: StatementLine) => a.day === b.day && a.cents === b.cents && a.text === b.text;

/** The view of one card bill's purchases: the saved rows, a form for one more, a box for lines copied from the statement. */
export function CardStatement({ bill, saved, onClose, onChanged }: { bill: BillFacts; saved: SavedStatement | null; onClose: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  const [from, setFrom] = useState(saved?.periodFrom ?? addDays(bill.bookingDate, -30));
  const [to, setTo] = useState(saved?.periodTo ?? bill.bookingDate);
  const [rows, setRows] = useState<StatementLine[]>(saved?.rows ?? []);
  const [day, setDay] = useState("");
  const [text, setText] = useState("");
  const [sum, setSum] = useState("");
  const [pasted, setPasted] = useState("");
  const [note, setNote] = useState<{ payments: number; unread: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const billCents = -bill.amountCents;
  const total = rows.reduce((a, r) => a + r.cents, 0);
  const difference = billCents - total;
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));

  const add = (more: StatementLine[]) => setRows((now) => [...now, ...more.filter((r) => !now.some((n) => sameRow(n, r)))]);
  const addOne = () => {
    const cents = parseEuros(sum);
    if (!day || !text.trim() || !cents) return setError("Täytä päivä, kuvaus ja summa.");
    setError(null);
    add([{ day, cents, text: text.trim() }]);
    setText("");
    setSum("");
  };
  const readPasted = () => {
    const r = readStatement(pasted, to);
    setError(null);
    add(r.rows);
    setNote({ payments: r.payments, unread: r.unread });
    setPasted("");
  };
  const call = async (method: "PUT" | "DELETE") => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/statements/${encodeURIComponent(bill.id)}`, { method, body: method === "PUT" ? { periodFrom: from, periodTo: to, statementCents: null, rows } : undefined });
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="confirm cs-dialog" aria-labelledby="cs-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="cs-title">Erittele ostot</h2>
      <dl className="cs-facts">
        <dt>Lasku</dt>
        <dd>
          {bill.merchant} {date(bill.bookingDate)}
        </dd>
        <dt>Summa</dt>
        <dd className="num">{money(billCents)}</dd>
        <dt>Jakso</dt>
        <dd className="cs-period">
          <input type="date" aria-label="Jakson alku" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" aria-label="Jakson loppu" value={to} onChange={(e) => setTo(e.target.value)} />
        </dd>
      </dl>
      {sorted.length > 0 && (
        <div className="cs-rows">
          <Table
            caption="Erittelyn rivit"
            rows={sorted}
            rowKey={(r) => `${r.day}|${r.cents}|${r.text}`}
            columns={[
              { key: "day", label: "Päivä", kind: "date", cell: (r) => date(r.day) },
              { key: "text", label: "Kuvaus", kind: "text", cell: (r) => r.text },
              { key: "sum", label: "Summa", kind: "money", main: true, precision: "cents", cents: (r) => r.cents },
              {
                key: "remove",
                label: "Toiminnot",
                headHidden: true,
                kind: "text",
                cell: (r) => (
                  <button className="btn btn-small" type="button" aria-label={`Poista rivi: ${r.text}`} onClick={() => setRows((now) => now.filter((n) => !sameRow(n, r)))}>
                    Poista
                  </button>
                ),
              },
            ]}
          />
        </div>
      )}
      {rows.length > 0 && (
        <dl className="cs-facts">
          <dt>Erotus</dt>
          <dd className="num cs-difference">{difference === 0 ? money(0) : `${money(difference)} selvittämättä`}</dd>
        </dl>
      )}
      <div className="cs-add">
        <input type="date" aria-label="Päivä" value={day} onChange={(e) => setDay(e.target.value)} />
        <input type="text" aria-label="Kuvaus" value={text} onChange={(e) => setText(e.target.value)} />
        <input type="text" inputMode="decimal" aria-label="Summa" value={sum} placeholder={eurosText(0)} onChange={(e) => setSum(e.target.value)} />
        <button className="btn" type="button" onClick={addOne}>
          Lisää
        </button>
      </div>
      <label className="field-label" htmlFor="cs-paste">
        Liitä rivit
      </label>
      <textarea id="cs-paste" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} />
      <div className="form-row">
        <button className="btn" type="button" disabled={!pasted.trim()} onClick={readPasted}>
          Lue
        </button>
      </div>
      {note && note.payments > 0 && <p>{plural(note.payments, "maksurivi", "maksuriviä")} jätettiin pois.</p>}
      {note && note.unread.length > 0 && (
        <div className="cs-unread">
          <span className="field-label">Ei luettu</span>
          {note.unread.map((l, i) => (
            <div key={`${i}|${l}`}>{l}</div>
          ))}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-row">
        {saved && (
          <button className="btn btn-danger" type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => call("DELETE")}>
            Poista erittely
          </button>
        )}
        <button className="btn" type="button" onClick={onClose}>
          Peruuta
        </button>
        <button className="btn btn-primary" type="button" disabled={busy || rows.length === 0} aria-busy={busy || undefined} onClick={() => call("PUT")}>
          Tallenna
        </button>
      </div>
    </dialog>
  );
}
