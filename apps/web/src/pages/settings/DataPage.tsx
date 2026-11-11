/** Asetukset > Tiedot: the household's own data (export, import) and the example data. */
import { useState } from "react";
import { api } from "../../api.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { CardStack } from "./CardStack.tsx";
import { DataExport } from "./DataExport.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown, useRunner } from "./use-settings-page.ts";
import { t } from "../../text.ts";

export function DataPage({ meta, params, anchor, onChange }: SettingsPageProps) {
  const hasDemo = meta.accounts.some((a) => a.provider === "demo");
  const { busy, message, run } = useRunner(onChange);
  const [askDemo, setAskDemo] = useState(false);

  const { shown } = useCardsShown({ expected: 0, ready: true, failed: false });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);

  return (
    <div className="stack">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <CardStack shown={shown}>
        <DataExport />

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
