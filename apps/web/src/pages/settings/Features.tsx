/** Asetukset > Palvelin (admin): switches for the modules that are not finished yet (core's FEATURES). */
import { FEATURES, FEATURE_IDS, type FeatureDef, type FeatureId } from "@banking/core";
import { useState } from "react";
import { api } from "../../api.ts";
import type { InstanceState } from "../../types.ts";

/** A dev flag is not offered: its module does nothing useful yet. Developers switch it through the API. */
export const SWITCHABLE = FEATURE_IDS.filter((id) => (FEATURES[id] as FeatureDef).stage !== "dev");

const STAGE = { dev: "Kehitysvaiheessa, ei vielä käytettävissä.", preview: "Esikatselu: voi muuttua.", stable: "Valmis." } as const;

export function FeatureFlags({ state, onState }: { state: InstanceState; onState: (next: InstanceState) => void }) {
  // the box shows the choice at once while the server saves it, and goes back if the save fails
  const [pending, setPending] = useState<{ id: FeatureId; on: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = async (id: FeatureId, on: boolean) => {
    setPending({ id, on });
    setError(null);
    try {
      onState(await api<InstanceState>("/api/admin/features", { method: "PUT", body: { [id]: on } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="setup-form">
      {SWITCHABLE.map((id) => (
        <label key={id} className="check">
          <input type="checkbox" checked={pending?.id === id ? pending.on : state.features[id]} disabled={pending !== null} onChange={(e) => void set(id, e.target.checked)} />
          <span>
            {FEATURES[id].label}
            <span className="field-help">{STAGE[FEATURES[id].stage]}</span>
          </span>
        </label>
      ))}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
