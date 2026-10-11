import { isUsablePattern } from "@banking/core";
import { useState } from "react";
import { api } from "../api.ts";
import { CategorySelect } from "../components/CategorySelect.tsx";
import { useApi } from "../hooks.ts";
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
  const label = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;

  // one request at a time: a double click must not create the rule twice
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
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
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Säännöt</h2>
            <div className="card-sub">Sääntö siirtää kaikki sitä vastaavat tapahtumat valittuun kategoriaan, myös tulevat. Käsin valittu kategoria menee säännön edelle.</div>
          </div>
        </div>
        <form className="form-row" onSubmit={add}>
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
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Lisää
          </button>
        </form>
        {(error ?? loadError) && <div className="error">{error ?? loadError}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kenttä</th>
                <th>Hakusana</th>
                <th>Kategoria</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.rules.map((r) => (
                <tr key={r.id}>
                  <td>{FIELD_LABEL[r.field]}</td>
                  <td>
                    <code>{r.pattern}</code>
                    {/* older versions accepted regexes; only the simple ones still match */}
                    {!isUsablePattern(r.pattern) && (
                      <span className="badge warn" title="Sääntö ei osu enää mihinkään. Poista se ja lisää tilalle sana tai kauppiaan nimi.">
                        ei osumia
                      </span>
                    )}
                  </td>
                  <td>{label(r.category)}</td>
                  <td className="num">
                    <button
                      className="btn btn-small btn-danger"
                      disabled={busy}
                      aria-label={`Poista sääntö: ${r.pattern}`}
                      onClick={() => void run(() => api(`/api/rules/${r.id}`, { method: "DELETE" }))}
                    >
                      Poista
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.rules.length && <div className="empty">Ei sääntöjä vielä. Lisää yllä sana, joka on kauppiaan nimessä tai viestissä, tai vaihda kategoria Tapahtumat-sivulla.</div>}
        </div>
      </div>
    </div>
  );
}
