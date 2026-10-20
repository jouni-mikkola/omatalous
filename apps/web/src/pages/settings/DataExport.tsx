import { useState } from "react";
import { apiDownload, saveFile } from "../../api.ts";
import { DataImport } from "./DataImport.tsx";

/** Asetukset > Tiedot: the user's own data and what is shared with them as one file; its format is docs/DATA_EXPORT.md. */
export function DataExport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await apiDownload("/api/data/export", {});
      saveFile(blob, filename);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tiedot</h2>
        <div className="form-row" style={{ margin: 0 }}>
          <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void download()}>
            Vie kaikki tiedot
          </button>
          <DataImport />
        </div>
      </div>
      <p>Tiedosto sisältää omat tietosi ja sinulle jaetut tiedot. Säilytä se turvallisesti.</p>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
