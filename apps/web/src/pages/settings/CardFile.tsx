/** Asetukset > Pankit ja tilit: the rows of a card statement the file picker found, to check and save. Only the rows are sent. */
// Decision: a household whose bank cannot give a card's rows gets them from the statement, and the file itself never leaves the browser (ADR 0025)
import { type CardFileRead, readCardFile } from "@banking/core";
import { useState } from "react";
import { api, ApiError } from "../../api.ts";
import { Table } from "../../components/table/Table.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { date, money } from "../../format.ts";
import type { Meta } from "../../types.ts";
import { t, tn } from "../../text.ts";

type Problem = "empty" | "many" | "save";

/** `text` is the statement as the picker read it; a new pick mounts this again (`key`). */
export function CardRows({ text, meta, onChange }: { text: string; meta: Meta; onChange: () => void }) {
  const [initial] = useState(() => {
    const result = readCardFile(text);
    return result.ok ? { read: result, problem: null } : { read: null, problem: (result.error === "no_rows" ? "empty" : "many") as Problem };
  });
  const [read, setRead] = useState<(CardFileRead & { rows: CardFileRead["rows"] }) | null>(initial.read);
  const [problem, setProblem] = useState<Problem | null>(initial.problem);
  const [account, setAccount] = useState("");
  const [name, setName] = useState(initial.read?.cardLast4 ? `${t("card_file.default_name")} ${initial.read.cardLast4}` : t("card_file.default_name"));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const cards = meta.accounts.filter((a) => a.provider === "cardfile");

  const save = async () => {
    if (!read) return;
    setSaving(true);
    setProblem(null);
    setRefusal(null);
    try {
      // the rows only: no file, no layout, no text of the file around them
      const r = await api<{ inserted: number; fetched: number }>("/api/card-file", {
        method: "POST",
        body: { accountId: account || null, name: account ? null : name, last4: read.cardLast4, rows: read.rows.map(({ day, cents, text }) => ({ day, cents, text })) },
      });
      setSaved(t("card_file.saved", { inserted: r.inserted, known: r.fetched - r.inserted }));
      setRead(null);
      onChange();
    } catch (e) {
      // the server's own sentence says why; only an answer without one is "try again"
      if (e instanceof ApiError && e.messageCode) setRefusal(e.message);
      else setProblem("save");
    } finally {
      setSaving(false);
    }
  };

  const error: Record<Problem, string> = {
    empty: t("card_file.err_empty"),
    many: t("card_file.err_many", { max: 1000 }),
    save: t("card_file.err_save"),
  };

  return (
    <div className="stack">
        {problem && <Notice tone="warning">{error[problem]}</Notice>}
        {refusal && <Notice tone="warning">{refusal}</Notice>}
        {saved && <Notice tone="good">{saved}</Notice>}
        {read && (
          <>
            <p>{t("card_file.found", { rows: read.rows.length, from: date(read.periodFrom!), to: date(read.periodTo!) })}</p>
            {read.unread.length > 0 && <Notice tone="warning">{tn(read.unread.length, "card_file.unread_one", "card_file.unread")}</Notice>}
            <Table
              caption={t("card_file.caption")}
              rows={read.rows.map((r, i) => ({ ...r, i }))}
              rowKey={(r) => String(r.i)}
              columns={[
                { key: "day", label: t("card_file.col_day"), kind: "date", cell: (r) => date(r.day) },
                { key: "text", label: t("card_file.col_text"), kind: "text", rowHead: true, cell: (r) => r.text },
                { key: "sum", label: t("card_file.col_sum"), kind: "money", cell: (r) => money(r.cents) },
              ]}
            />
            <div className="form-row">
              <label>
                <span className="field-label">{t("card_file.card")}</span>
                <select value={account} onChange={(e) => setAccount(e.target.value)}>
                  <option value="">{t("card_file.card_new")}</option>
                  {cards.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              {!account && (
                <label>
                  <span className="field-label">{t("card_file.name")}</span>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                </label>
              )}
              <Button variant="primary" onClick={() => void save()} busy={saving}>
                {t("card_file.save")}
              </Button>
            </div>
          </>
        )}
    </div>
  );
}
