/**
 * Asetukset > Tekniset asetukset: what the plain page leaves out. For everyone the run of the bank fetch, the data quality
 * notes, the signed-in devices, the member's own Enable Banking application and the example data; for an admin after them
 * the server, the security log and the maintenance cards.
 */
import { api, query } from "../../api.ts";
import { dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { periodRange } from "../../period.ts";
import { settingsCard } from "../../routes.ts";
import type { Meta, ReportsData, SyncRun } from "../../types.ts";
import { reportContext } from "../reports/context.ts";
import { reportsOf, visibleSections } from "../reports/registry.ts";
import { BankKey } from "./BankKey.tsx";
import { syncHoursLabel } from "./InstanceForms.tsx";
import { Maintenance } from "./Maintenance.tsx";
import { SecurityLog, Sessions } from "./Security.tsx";
import { ServerSettings } from "./Server.tsx";
import { useCardScroll, useLoadedCount, useRunner } from "./use-settings-page.ts";

const RUN_STATUS: Record<string, string> = { ok: "onnistui", partial: "osittain", failed: "epäonnistui", running: "käynnissä" };

/** The cards that load their own data above the maintenance cards: the devices, and for an admin the server and the log. */
const ADMIN_PARTS = 3;

/** The fetch runs. A column with nothing in any row is not drawn; one message brings it back. */
export function RunsTable({ runs }: { runs: SyncRun[] }) {
  const hasMessage = runs.some((r) => !!r.message);
  return (
    <table className="ruled run-table">
      <thead>
        <tr>
          <th>Aloitettu</th>
          <th>Tapa</th>
          <th>Tila</th>
          <th className="num">Uusia</th>
          {hasMessage && <th>Viesti</th>}
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td className="run-when">{dateTime(r.startedAt)}</td>
            <td className="run-when">{r.trigger === "schedule" ? "ajastettu" : r.trigger === "connect" ? "uusi yhteys" : r.trigger === "open" || r.trigger === "open-bare" ? "avattaessa" : "käsin"}</td>
            <td>{RUN_STATUS[r.status] ?? r.status}</td>
            <td className="num">{r.inserted}</td>
            {hasMessage && <td className="small muted">{r.message ?? ""}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Technical({ meta, params, anchor, onChange }: { meta: Meta; params: URLSearchParams; anchor?: string; onChange: () => void }) {
  const isAdmin = meta.user.role === "admin";
  const hasConnection = meta.connections.some((c) => c.status === "active");
  const hasDemo = meta.accounts.some((a) => a.provider === "demo");
  const runs = useApi<{ runs: SyncRun[] }>("/api/sync/runs");
  const { busy, message, run } = useRunner(onChange);

  // the data quality notes: the last twelve whole months, as Raportit opens
  const range = periodRange("12m", meta.today);
  const wantQuality = meta.accounts.length > 0;
  const quality = useApi<ReportsData>(wantQuality ? `/api/reports${query({ ...range, scope: "own", reports: reportsOf("settings").join(",") })}` : null);
  const qualityCtx = quality.data ? reportContext(quality.data, meta, range, "own") : null;
  const qualityNotes = qualityCtx ? visibleSections(qualityCtx, "settings").map((s) => <s.Component key={s.id} ctx={qualityCtx} />) : null;

  // an address names a card: the scroll waits for the cards above it, which load their own data
  const [loaded, partLoaded] = useLoadedCount();
  const settled =
    (runs.data !== null || runs.error !== null) && (!wantQuality || quality.data !== null || quality.error !== null) && loaded >= (isAdmin ? ADMIN_PARTS : 1);
  const target = settingsCard({ page: "settings", params, ...(anchor ? { anchor } : {}) });
  useCardScroll(target, `${params.toString()}#${target}`, settled);

  return (
    <div className="stack">
      <p>
        <a href="#/settings">← Asetukset</a>
      </p>
      {message && <div className={`notice ${message.tone}`}>{message.text}</div>}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Haku pankista</h2>
            <div className="card-sub">
              {!hasConnection
                ? "Ei pankkiyhteyttä"
                : meta.sync.hours.length
                  ? `Automaattinen haku klo ${syncHoursLabel(meta.sync.hours)}`
                  : "Automaattinen haku ei ole käytössä"}
            </div>
          </div>
        </div>
        <div className="table-wrap">
          {runs.data && <RunsTable runs={runs.data.runs} />}
          {runs.error && <div className="error">{runs.error}</div>}
          {runs.data && !runs.data.runs.length && <div className="empty">Ei hakuja.</div>}
        </div>
      </div>

      {qualityNotes}

      <Sessions onLoaded={partLoaded} />

      {/* only when the household has no shared Enable Banking application, or the member has a key of their own */}
      {meta.bank.source !== "instance" && <BankKey meta={meta} onChange={onChange} />}

      {(meta.accounts.length === 0 || hasDemo) && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Esimerkkitiedot</h2>
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <button className="btn" disabled={busy !== null} aria-busy={busy === "demo" || undefined} onClick={() => run("demo", async () => { await api("/api/demo", { method: "POST" }); return "Esimerkkitiedot ladattu."; })}>
                {hasDemo ? "Lataa uudelleen" : "Lataa esimerkkitiedot"}
              </button>
              {hasDemo && (
                <button className="btn btn-danger" disabled={busy !== null} aria-busy={busy === "demo-del" || undefined} onClick={() => run("demo-del", async () => { await api("/api/demo", { method: "DELETE" }); return "Esimerkkitiedot poistettu."; })}>
                  Poista esimerkkitiedot
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {isAdmin && (
        <>
          <ServerSettings onChange={onChange} onLoaded={partLoaded} />
          <SecurityLog onLoaded={partLoaded} />
          <Maintenance />
        </>
      )}
    </div>
  );
}
