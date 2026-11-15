import { useState } from "react";
import { apiDownload, saveFile } from "../../api.ts";
import { DataImport } from "./DataImport.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";
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
        <h2>{t("set.dx.data")}</h2>
        <div className="form-row flush">
          <Button disabled={busy} aria-busy={busy} onClick={() => void download()}>
            {t("set.dx.export_all_data")}
          </Button>
          <DataImport />
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
