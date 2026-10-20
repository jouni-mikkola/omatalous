/** Asetukset > Palvelin (admin): the same settings as the first-run wizard. */
import { useState } from "react";
import { useApi } from "../../hooks.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import type { InstanceState } from "../../types.ts";
import { FeatureFlags, SWITCHABLE } from "./Features.tsx";
import { BankAppSetup } from "./BankAppSetup.tsx";
import { GeneralForm } from "./InstanceForms.tsx";
import { RemoteAccess } from "./RemoteAccess.tsx";
import { useReportLoaded } from "./use-settings-page.ts";

export function ServerSettings({ onChange, onLoaded }: { onChange: () => void; onLoaded?: (failed: boolean) => void }) {
  const loaded = useApi<InstanceState>("/api/admin/instance");
  const [state, setState] = useState<InstanceState | null>(null);
  const current = state ?? loaded.data;

  // the page scrolls to this card (#/settings?section=server) and to the cards below it only after this one has its height
  useReportLoaded(current !== null || loaded.error !== null, onLoaded, loaded.error !== null);

  const update = (next: InstanceState) => {
    setState(next);
    onChange(); // the bank picker and the sync card read /api/meta
  };

  return (
    <>
      <div className="card" id={SETTINGS_ANCHOR.server}>
        <div className="card-head">
          <div>
            <h2>Palvelin</h2>
          </div>
        </div>
        {loaded.error && <div className="notice warning">{loaded.error}</div>}
        {current && <GeneralForm state={current} submitLabel="Tallenna" onSaved={update} />}
      </div>
      {current && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Enable Banking -sovellus</h2>
            </div>
          </div>
          <BankAppSetup state={current} onState={update} compact />
        </div>
      )}
      {current && <RemoteAccess />}
      {current && SWITCHABLE.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Kokeiltavat toiminnot</h2>
            </div>
          </div>
          <FeatureFlags state={current} onState={update} />
        </div>
      )}
    </>
  );
}
