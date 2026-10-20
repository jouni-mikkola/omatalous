import { isUsablePattern } from "@banking/core";
import { useState } from "react";
import { api } from "../api.ts";
import { CategorySelect } from "../components/CategorySelect.tsx";
import { PayerAnswers } from "../components/PayerAnswers.tsx";
import { DataTable } from "../components/table/DataTable.tsx";
import { useApi } from "../hooks.ts";
import { RULES_ANCHOR } from "../routes.ts";
import type { CategoryRule, Meta } from "../types.ts";

const FIELD_LABEL: Record<CategoryRule["field"], string> = {
  merchant: "Kauppias",
  merchant_exact: "Kauppias (tarkka)",
  description: "Viesti",
  counterparty: "Saaja/maksaja",
  any: "Kaikki kentät",
};

export function Rules({ meta }: { meta: Meta }) {
  const { data, error: loadError, reload } = useApi<{ rules: CategoryRule[] }>("/api/rules");
  const [field, setField] = useState<CategoryRule["field"]>("merchant");
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("groceries");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doing, setDoing] = useState("");
  const label = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;

  // one request at a time: a double click must not create the rule twice
  const run = async (fn: () => Promise<unknown>, key = "") => {
    if (busy) return;
    setBusy(true);
    setDoing(key);
    setError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("/api/rules", { method: "POST", body: { field, pattern, category } });
      setPattern("");
    });
  };

  return (
    <div className="stack">
      <div className="card" id={RULES_ANCHOR}>
        <div className="card-head tb">
          <div className="card-name">
            <h2>Säännöt</h2>
          </div>
        </div>
        <form className="form-row rule-form" onSubmit={add}>
          <select value={field} onChange={(e) => setField(e.target.value as CategoryRule["field"])} aria-label="Kenttä">
            {Object.entries(FIELD_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input type="text" placeholder="esimerkiksi Lidl tai Lidl|Prisma" value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Hakusana" required />
          <span className="muted">kategoriaan</span>
          <CategorySelect categories={meta.categories} value={category} onChange={setCategory} />
          <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
            Lisää
          </button>
        </form>
        {(error ?? loadError) && <div className="error">{error ?? loadError}</div>}
        <div className="table-wrap">
          {data && data.rules.length > 0 && (
          <DataTable
            id="rules"
            caption="Omat säännöt"
            rows={data.rules}
            rowKey={(r) => String(r.id)}
            phone="cards"
            columns={[
              { key: "field", label: "Kenttä", kind: "text", rowHead: true, cell: (r) => FIELD_LABEL[r.field] },
              {
                key: "pattern",
                label: "Hakusana",
                kind: "text",
                cell: (r) => (
                  <>
                    <code>{r.pattern}</code>
                    {/* older versions accepted regexes; only the simple ones still match */}
                    {!isUsablePattern(r.pattern) && (
                      <span className="badge warn" title="Sääntö ei osu enää mihinkään. Poista se ja lisää tilalle sana tai kauppiaan nimi.">
                        ei osumia
                      </span>
                    )}
                  </>
                ),
              },
              { key: "category", label: "Kategoria", kind: "text", cell: (r) => label(r.category) },
              {
                key: "delete",
                label: "",
                kind: "count",
                cell: (r) => (
                  <button
                    className="btn btn-small btn-danger"
                    disabled={busy}
                    aria-busy={(busy && doing === `del-${r.id}`) || undefined}
                    aria-label={`Poista sääntö: ${r.pattern}`}
                    onClick={() => void run(() => api(`/api/rules/${r.id}`, { method: "DELETE" }), `del-${r.id}`)}
                  >
                    Poista
                  </button>
                ),
              },
            ]}
          />
          )}
          {data && !data.rules.length && <div className="empty">Ei sääntöjä.</div>}
        </div>
      </div>
      <PayerAnswers />
    </div>
  );
}
