import { useState } from "react";
import { api } from "../api.ts";
import { useApi } from "../hooks.ts";
import { bannersOf, type SecurityNotice } from "./notices.ts";

/**
 * The notice of the server that stays a banner on every page (`BANNER_KINDS`: a damaged database). Every other notice is a
 * row of Ilmoitukset on Yhteenveto.
 */
export function SecurityNotices() {
  const { data, reload } = useApi<{ notices: SecurityNotice[] }>("/api/security/notices");
  const [error, setError] = useState<string | null>(null);
  const banners = bannersOf(data?.notices ?? []);
  if (!banners.length) return null;
  return (
    <div role="status">
      {banners.map((n) => (
        <div key={n.id} className="notice warning">
          {n.text} <a href="#/settings?section=security">Turvallisuus</a>
        </div>
      ))}
      <div className="form-row" style={{ marginTop: -8 }}>
        <button
          className="btn btn-small"
          type="button"
          onClick={() => {
            api("/api/security/notices/seen", { method: "POST" })
              .then(reload)
              .catch((e: Error) => setError(e.message));
          }}
        >
          Kuittaa
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}
