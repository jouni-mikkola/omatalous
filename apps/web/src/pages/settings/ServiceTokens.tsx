/**
 * Asetukset > Tekniset asetukset, for an admin: the service tokens, read-only keys for scripts and coding agents
 * (server services/service-tokens.ts). They are made only on the server's command line, so this card lists and removes.
 */
import { useState } from "react";
import { api } from "../../api.ts";
import { Table } from "../../components/table/Table.tsx";
import { dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";

interface ServiceToken {
  id: string;
  username: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
}

export function ServiceTokens() {
  const { data, error, reload } = useApi<{ tokens: ServiceToken[] }>("/api/admin/service-tokens");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const remove = async (t: ServiceToken) => {
    if (!window.confirm(`Poistetaanko palvelutunnus ${t.name}? Sitä käyttävä ohjelma ei pääse enää sisään.`)) return;
    setBusy(t.id);
    setFailed(null);
    try {
      await api(`/api/admin/service-tokens/${encodeURIComponent(t.id)}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card" id="palvelutunnukset">
      <div className="card-head">
        <div>
          <h2>Palvelutunnukset</h2>
          <div className="card-sub">
            Palvelutunnuksella ohjelma tai tekoälyavustaja lukee yhden käyttäjän tietoja ilman salasanaa. Se ei voi muuttaa mitään eikä avaa ylläpidon sivuja. Tunnus luodaan palvelimen komentorivillä:{" "}
            <code>service-token create &lt;käyttäjä&gt; --name &lt;nimi&gt;</code>
          </div>
        </div>
      </div>
      {(error ?? failed) && <div className="error">{error ?? failed}</div>}
      {data && data.tokens.length === 0 && <div className="empty">Ei palvelutunnuksia.</div>}
      {data && data.tokens.length > 0 && (
        <Table
          caption="Palvelutunnukset"
          rows={data.tokens}
          rowKey={(t) => t.id}
          page={10}
          columns={[
            { key: "name", label: "Nimi", kind: "text", rowHead: true, cell: (t) => t.name },
            { key: "user", label: "Käyttäjä", kind: "text", cell: (t) => t.username },
            { key: "until", label: "Voimassa", kind: "date", cell: (t) => dateTime(t.expiresAt) },
            { key: "used", label: "Viimeksi käytetty", kind: "date", cell: (t) => (t.lastUsedAt ? `${dateTime(t.lastUsedAt)}${t.lastUsedIp ? `, ${t.lastUsedIp}` : ""}` : "ei vielä") },
            {
              key: "remove",
              label: "Toiminnot",
              headHidden: true,
              kind: "count",
              cell: (t) => (
                <button className="btn btn-small btn-danger" type="button" disabled={busy !== null} aria-busy={busy === t.id || undefined} onClick={() => void remove(t)}>
                  Poista
                </button>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
