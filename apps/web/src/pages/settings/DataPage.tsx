/** Asetukset > Tiedot: the household's own data (export, import), the notes about its quality, and the example data. */
import { useState } from "react";
import { api, query } from "../../api.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { Opened } from "../../view-opens.tsx";
import { useApi } from "../../hooks.ts";
import { periodRange } from "../../period.ts";
import type { ReportsData } from "../../types.ts";
import { reportContext } from "../reports/context.ts";
import { reportsOf, visibleSections } from "../reports/registry.ts";
import { CardStack } from "./CardStack.tsx";
import { DataExport } from "./DataExport.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown, useRunner } from "./use-settings-page.ts";
import { t } from "../../text.ts";

export function DataPage({ meta, params, anchor, onChange }: SettingsPageProps) {
  const hasDemo = meta.accounts.some((a) => a.provider === "demo");
  const { busy, message, run } = useRunner(onChange);
  const [askDemo, setAskDemo] = useState(false);

  // the data quality notes: the last twelve whole months, as Raportit opens
  const range = periodRange("12m", meta.today);
  const wantQuality = meta.accounts.length > 0;
  const quality = useApi<ReportsData>(wantQuality ? `/api/reports${query({ ...range, scope: "own", reports: reportsOf("settings").join(",") })}` : null);
  const qualityCtx = quality.data ? reportContext(quality.data, meta, range, "own") : null;
  const qualitySections = qualityCtx ? visibleSections(qualityCtx, "settings") : [];
  const qualityNotes = qualityCtx ? [<Opened key="opened" views={qualitySections.map((s) => `report:${s.id}`)} />, ...qualitySections.map((s) => <s.Component key={s.id} ctx={qualityCtx} />)] : null;

  const { shown } = useCardsShown({ expected: 0, ready: !wantQuality || quality.data !== null || quality.error !== null, failed: quality.error !== null });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);

  return (
    <div className="stack">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <CardStack shown={shown}>
        <DataExport />

        {qualityNotes}

        {((meta.accounts.length === 0 && !meta.householdHasAccounts) || hasDemo) && (
          <div className="card">
            <div className="card-head">
              <div>
                <h2>{t("set.dpage.example_data")}</h2>
              </div>
              <div className="form-row settings-flush">
                <Button disabled={busy !== null} aria-busy={busy === "demo" || undefined} onClick={() => run("demo", async () => { await api("/api/demo", { method: "POST" }); return t("set.dpage.example_data_loaded"); })}>
                  {hasDemo ? t("set.dpage.reload") : t("set.dpage.load_example_data")}
                </Button>
                {hasDemo && (
                  <Button disabled={busy !== null} aria-busy={busy === "demo-del" || undefined} onClick={() => setAskDemo(true)}>
                    {t("set.dpage.remove_example_data")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {askDemo && (
          <ConfirmDialog
            title={t("set.dpage.remove_the_example_data")}
            confirmLabel={t("set.dpage.remove_example_data")}
            onConfirm={() => {
              setAskDemo(false);
              void run("demo-del", async () => {
                await api("/api/demo", { method: "DELETE" });
                return t("set.dpage.example_data_removed");
              });
            }}
            onCancel={() => setAskDemo(false)}
          >
            <p>{t("set.dpage.the_example_accounts_and_their")}</p>
          </ConfirmDialog>
        )}
      </CardStack>
    </div>
  );
}
