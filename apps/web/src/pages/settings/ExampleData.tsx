/** Asetukset > Pankit ja tilit: the example data, to load, to load again and to remove. The page runs the action and shows what it said. */
import { useState } from "react";
import { api } from "../../api.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { t } from "../../text.ts";
import type { Meta } from "../../types.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";

export function ExampleData({ meta, busy, run }: { meta: Meta; busy: string | null; run: (key: string, fn: () => Promise<string | void>) => Promise<void> }) {
  const hasDemo = meta.accounts.some((a) => a.provider === "demo");
  const [askDemo, setAskDemo] = useState(false);
  // offered while the household has no account of its own, and while the example accounts are there to remove
  if (!((meta.accounts.length === 0 && !meta.householdHasAccounts) || hasDemo)) return null;

  return (
    <>
      <div className="card" id={SETTINGS_ANCHOR.exampleData}>
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
    </>
  );
}
