/**
 * The one card of the bank app on Pankit ja tilit. The administrator chooses between the household's Enable Banking
 * application (the checked list, the test and the steps that are still open) and their own key; a member has the own
 * key only. Decision: whether banks can be linked yet, and what is left to do if they cannot.
 */
import { useState } from "react";
import { useApi } from "../../hooks.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import type { InstanceState, Meta } from "../../types.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import { BankAppSetup } from "./BankAppSetup.tsx";
import { BankKey } from "./BankKey.tsx";
import { FoldCard } from "../../components/ui/FoldCard.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { useReportLoaded } from "./use-settings-page.ts";
import { t } from "../../text.ts";

type Which = "household" | "own";

export function BankApp({ meta, onChange, onLoaded }: { meta: Meta; onChange: () => void; onLoaded?: (failed?: boolean) => void }) {
  const admin = meta.user.role === "admin";
  const loaded = useApi<InstanceState>(admin ? "/api/admin/instance" : null);
  const [state, setState] = useState<InstanceState | null>(null);
  const [picked, setPicked] = useState<Which | null>(null);
  const current = state ?? loaded.data;
  useReportLoaded(admin && (current !== null || loaded.error !== null), onLoaded, loaded.error !== null);
  const app = current?.bankApp;
  const own = meta.bank.source === "user";
  // a member has the choice too while the household has a shared application, and then it is the one in use
  const shared = meta.bank.source === "instance";
  const choice = admin || shared;
  const which: Which = choice ? (picked ?? (own ? "own" : "household")) : "own";
  // the guide and the buttons are folded once the Application ID works, and open as soon as something needs doing again
  const works = !!app && app.source !== null && !app.inactiveMessage && app.pendingSince === null;
  const folded = !admin || own || (which === "household" && (works || !app));
  const sub = which === "own" ? (own ? t("set.key.own_key_in_use") : t("set.key.not_set_up")) : !admin ? t("set.bapp.household_in_use") : works ? t("set.bapp.works", { id: app.appId ?? "" }) : undefined;

  return (
    <FoldCard id={SETTINGS_ANCHOR.bankApp} title={t("set.bapp.bank_app")} sub={sub} folded={folded}>
      {choice && (
        <Segmented
          label={t("set.bapp.application")}
          value={which}
          onChange={setPicked}
          options={[
            { value: "household", label: t("set.bapp.household_application") },
            { value: "own", label: t("set.bapp.own_application") },
          ]}
        />
      )}
      {which === "household" && loaded.error && <Notice tone="warning">{loaded.error}</Notice>}
      {which === "household" && current && (
        <BankAppSetup
          state={current}
          onState={(next) => {
            setState(next);
            onChange(); // the bank picker and the sync card read /api/meta
          }}
          calm
        />
      )}
      {which === "household" && !admin && <p className="small muted">{t("set.bapp.admin_keeps_it")}</p>}
      {which === "own" && <BankKey meta={meta} onChange={onChange} />}
    </FoldCard>
  );
}
