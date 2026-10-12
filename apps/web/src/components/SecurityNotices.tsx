import { useState } from "react";
import { api } from "../api.ts";
import { useApi } from "../hooks.ts";

interface Notice {
  id: string;
  kind: string;
  text: string;
}

/** Notices about copies, the disk and the host helper: their text sends the admin to Asetukset > Ylläpito (the server's db-health.ts). */
const MAINTENANCE = new Set(["copy_missing", "copy_check_failed", "disk_low", "helper_silent"]);

/** Notices from the server: failed logins, a new device, a password reset by an admin, and for admins a changed default. */
export function SecurityNotices() {
  const { data, reload } = useApi<{ notices: Notice[] }>("/api/security/notices");
  const [error, setError] = useState<string | null>(null);
  if (!data?.notices.length) return null;
  return (
    <div role="status">
      {data.notices.map((n) => (
        <div key={n.id} className="notice warning">
          {n.text}{" "}
          {n.kind === "industry_lookup_off" && <a href="#/settings?section=server">Asetukset &gt; Palvelin</a>}
          {MAINTENANCE.has(n.kind) && <a href="#/settings?section=maintenance">Avaa ylläpito</a>}
          {n.kind !== "industry_lookup_off" && !MAINTENANCE.has(n.kind) && <a href="#/settings?section=security">Turvallisuus</a>}
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
