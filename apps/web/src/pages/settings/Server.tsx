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

export function ServerSettings({ onChange, onLoaded }: { onChange: () => void; onLoaded?: () => void }) {
  const loaded = useApi<InstanceState>("/api/admin/instance");
  const [state, setState] = useState<InstanceState | null>(null);
  const current = state ?? loaded.data;

  // the page scrolls to this card (#/settings?section=server) and to the cards below it only after this one has its height
  useReportLoaded(current !== null || loaded.error !== null, onLoaded);

  const update = (next: InstanceState) => {
    setState(next);
    onChange(); // the bank picker and the sync card read /api/meta
  };

  return (
    <div className="card" id={SETTINGS_ANCHOR.server}>
      <div className="card-head">
        <div>
          <h2>Palvelin</h2>
        </div>
      </div>
      {loaded.error && <div className="notice warning">{loaded.error}</div>}
      {current && (
        <div className="stack">
          <GeneralForm state={current} submitLabel="Tallenna" onSaved={update} />
          <div>
            <h3 className="subhead">Enable Banking -sovellus</h3>
            <BankAppSetup state={current} onState={update} compact />
          </div>
          <RemoteAccess />
          {SWITCHABLE.length > 0 && (
            <div>
              <h3 className="subhead">Kokeiltavat toiminnot</h3>
              <FeatureFlags state={current} onState={update} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
