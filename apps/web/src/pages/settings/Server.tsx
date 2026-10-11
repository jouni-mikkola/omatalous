/** Asetukset > Palvelin (admin): the same settings as the first-run wizard. */
import { useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks.ts";
import type { InstanceState } from "../../types.ts";
import { FeatureFlags, SWITCHABLE } from "./Features.tsx";
import { BankAppSetup } from "./BankAppSetup.tsx";
import { GeneralForm } from "./InstanceForms.tsx";

export function ServerSettings({ focus, onChange }: { focus: boolean; onChange: () => void }) {
  const loaded = useApi<InstanceState>("/api/admin/instance");
  const [state, setState] = useState<InstanceState | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const current = state ?? loaded.data;

  // opened from a link (#/settings?section=server): bring the card into view once
  useEffect(() => {
    if (!focus || !current || scrolled.current) return;
    scrolled.current = true;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, current]);

  const update = (next: InstanceState) => {
    setState(next);
    onChange(); // the bank picker and the sync card read /api/meta
  };

  return (
    <div className="card" ref={ref} id="palvelin">
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
