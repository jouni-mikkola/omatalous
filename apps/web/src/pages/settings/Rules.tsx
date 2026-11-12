import { isUsablePattern } from "@banking/core";
import { useState } from "react";
import { api } from "../../api.ts";
import { CategorySelect } from "../../components/CategorySelect.tsx";
import { PayerAnswers } from "../../components/PayerAnswers.tsx";
import { Table } from "../../components/table/Table.tsx";
import { useApi } from "../../hooks.ts";
import { RULES_ANCHOR } from "../../routes.ts";
import { labelTable, t } from "../../text.ts";
import type { CategoryRule, Meta } from "../../types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { Empty } from "../../components/ui/Empty.tsx";
import "../../styles/categories.css";
const FIELD_LABEL = labelTable<CategoryRule["field"]>({
  merchant: () => t("rule.field_merchant"),
  merchant_exact: () => t("rule.field_merchant_exact"),
  description: () => t("rule.field_description"),
  counterparty: () => t("rule.field_counterparty"),
  any: () => t("rule.field_any"),
});

/** Asetukset > Talous: the rules that give a row its category, and the answers about payers under them. */
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
            <h2>{t("rule.heading")}</h2>
          </div>
        </div>
        {/* each field has its name above it, as the other forms of the household: a loose "kategoriaan" between two fields
            stood alone on a line on a phone */}
        <form className="form-row form-fields rule-form" onSubmit={add}>
          <label className="field">
            {t("rule.field")}
            <select value={field} onChange={(e) => setField(e.target.value as CategoryRule["field"])}>
              {Object.entries(FIELD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field rule-pattern">
            {t("rule.pattern")}
            <input type="text" placeholder={t("rule.pattern_example")} value={pattern} onChange={(e) => setPattern(e.target.value)} required />
          </label>
          <label className="field">
            {t("rule.category")}
            <CategorySelect categories={meta.categories} value={category} onChange={setCategory} ariaLabel={t("rule.category")} />
          </label>
          <Button variant="primary" type="submit" busy={busy}>
            {t("rule.add")}
          </Button>
        </form>
        {(error ?? loadError) && <Notice tone="error">{error ?? loadError}</Notice>}
        {data && data.rules.length > 0 && (
        <Table
          caption={t("rule.own")}
          rows={data.rules}
          rowKey={(r) => String(r.id)}
          page={25}
          columns={[
            { key: "field", label: t("rule.field"), kind: "text", rowHead: true, cell: (r) => FIELD_LABEL[r.field] },
            {
              key: "pattern",
              label: t("rule.pattern"),
              kind: "text",
              cell: (r) => (
                <>
                  <code>{r.pattern}</code>
                  {/* older versions accepted regexes; only the simple ones still match */}
                  {!isUsablePattern(r.pattern) && (
                    <span className="badge warn" title={t("rule.no_match_title")}>
                      {t("rule.no_match")}
                    </span>
                  )}
                </>
              ),
            },
            { key: "category", label: t("rule.category"), kind: "text", cell: (r) => label(r.category) },
            {
              key: "delete",
              label: t("rule.actions"),
              headHidden: true,
              kind: "count",
              cell: (r) => (
                <Button
                  variant="link"
                  disabled={busy}
                  aria-busy={(busy && doing === `del-${r.id}`) || undefined}
                  aria-label={t("rule.delete_label", { pattern: r.pattern })}
                  onClick={() => void run(() => api(`/api/rules/${r.id}`, { method: "DELETE" }), `del-${r.id}`)}
                >
                  {t("rule.delete")}
                </Button>
              ),
            },
          ]}
        />
        )}
        {data && !data.rules.length && <Empty>{t("rule.none")}</Empty>}
      </div>
      <PayerAnswers />
    </div>
  );
}
