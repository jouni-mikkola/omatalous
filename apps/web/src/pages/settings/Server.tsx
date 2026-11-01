/** Asetukset > Palvelin (admin): the same settings as the first-run wizard. */
import { useState } from "react";
import { useApi } from "../../hooks.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import type { InstanceState } from "../../types.ts";
import { GeneralForm } from "./InstanceForms.tsx";
import { OffsiteBackup } from "./OffsiteBackup.tsx";
import { OutsideNotices } from "./OutsideNotices.tsx";
import { RemoteAccessBody, type RemoteAccessPoll } from "./RemoteAccess.tsx";
import { UnopenedViews } from "./UnopenedViews.tsx";
import { useReportLoaded } from "./use-settings-page.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";
export function ServerSettings({ remote, onChange, onLoaded }: { remote: RemoteAccessPoll; onChange: () => void; onLoaded?: (failed?: boolean) => void }) {
  const loaded = useApi<InstanceState>("/api/admin/instance");
  const [state, setState] = useState<InstanceState | null>(null);
  const current = state ?? loaded.data;

  // the page scrolls to this card (#/settings/server#palvelin) and to the cards below it only after this one has its height
  useReportLoaded(current !== null || loaded.error !== null, onLoaded, loaded.error !== null);

  const update = (next: InstanceState) => {
    setState(next);
    onChange();
  };

  return (
    <>
      <div className="card" id={SETTINGS_ANCHOR.server}>
        <div className="card-head">
          <div>
            <h2>{t("set.sv.server")}</h2>
          </div>
        </div>
        {loaded.error && <Notice tone="warning">{loaded.error}</Notice>}
        {current && <GeneralForm state={current} submitLabel={t("set.sv.save")} onSaved={update} />}
      </div>
      {current && <OffsiteBackup />}
      {current && <RemoteAccessBody poll={remote} />}
      {current && <OutsideNotices />}
      {current && <UnopenedViews />}
    </>
  );
}
