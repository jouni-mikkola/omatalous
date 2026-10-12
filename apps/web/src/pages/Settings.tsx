import { useCallback, useEffect, useRef, useState } from "react";
import { api, query } from "../api.ts";
import { dateTime, plural } from "../format.ts";
import { navigate, useApi } from "../hooks.ts";
import { periodRange } from "../period.ts";
import { SETTINGS_ANCHOR } from "../routes.ts";
import type { Meta, ReportsData, SyncRun } from "../types.ts";
import { reportContext } from "./reports/context.ts";
import { reportsOf, visibleSections } from "./reports/registry.ts";
import { Accounts } from "./settings/Accounts.tsx";
import { BankConnections, connectedMessage, connectError } from "./settings/BankConnections.tsx";
import { BankKey } from "./settings/BankKey.tsx";
import { syncHoursLabel } from "./settings/InstanceForms.tsx";
import { Loans } from "./settings/Loans.tsx";
import { Maintenance } from "./settings/Maintenance.tsx";
import { Members } from "./settings/Members.tsx";
import { Login, SecurityLog } from "./settings/Security.tsx";
import { ServerSettings } from "./settings/Server.tsx";
import { Sharing } from "./settings/Sharing.tsx";
import "../styles/settings.css";

const RUN_STATUS: Record<string, string> = { ok: "onnistui", partial: "osittain", failed: "epäonnistui", running: "käynnissä" };

/**
 * Asetukset has two tabs. Omat is every member's own: bank connections, accounts and how good their data is, sharing,
 * signing in. Talous (admin) is the household's: members, the server, the security log and the way to maintenance.
 * `?tab=talous` opens the second; so does `?section=server`, at Palvelin. `?add=1` opens Omat at the bank picker, and
 * an address anchor (`#kirjautuminen`) scrolls to its card. `?section=csv` of the removed import opens Omat and scrolls
 * nowhere.
 */
export function Settings({ meta, params, anchor, onChange }: { meta: Meta; params: URLSearchParams; anchor?: string; onChange: () => void }) {
  const runs = useApi<{ runs: SyncRun[] }>("/api/sync/runs");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "warning"; text: string } | null>(() => {
    const connected = params.get("connected");
    if (connected !== null && /^\d+$/.test(connected)) return connectedMessage(Number(connected));
    const error = params.get("error");
    if (error) return { tone: "warning", text: connectError(error) };
    return null;
  });
  const hasConnection = meta.connections.some((c) => c.status === "active");
  const isAdmin = meta.user.role === "admin";
  const section = params.get("section");
  const maintenance = section === "maintenance" && isAdmin;
  const talous = isAdmin && !maintenance && (params.get("tab") === "talous" || section === "server");

  // the data quality notes under Tilit: the last twelve whole months, as Raportit opens
  const range = periodRange("12m", meta.today);
  const wantQuality = !talous && !maintenance && meta.accounts.length > 0;
  const quality = useApi<ReportsData>(wantQuality ? `/api/reports${query({ ...range, scope: "own", reports: reportsOf("settings").join(",") })}` : null);
  const qualityCtx = quality.data ? reportContext(quality.data, meta, range, "own") : null;
  const qualityNotes = qualityCtx ? visibleSections(qualityCtx, "settings").map((s) => <s.Component key={s.id} ctx={qualityCtx} />) : null;

  // Talous: the cards above the one an address names load their own data, so the scroll waits for them
  const [talousParts, setTalousParts] = useState(0);
  const partLoaded = useCallback(() => setTalousParts((n) => n + 1), []);
  // Omat: the loans card sits above cards an address names and loads its own list
  const [loansLoaded, setLoansLoaded] = useState(false);
  const loansDone = useCallback(() => setLoansLoaded(true), []);

  // an address names a card (#kirjautuminen, #laatu): scroll to it once, after what sits above it has loaded, so the
  // card does not move away after the scroll
  const target = anchor;
  const key = target ? `${params.toString()}#${target}` : null;
  const runsLoaded = runs.data !== null || runs.error !== null;
  const qualityLoaded = !wantQuality || quality.data !== null || quality.error !== null;
  const settled = talous ? talousParts >= 2 : runsLoaded && qualityLoaded && loansLoaded;
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!key || !settled || scrolledFor.current === key) return;
    scrolledFor.current = key;
    document.getElementById(target!)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [key, target, settled]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const text = await fn();
      if (text) setMessage({ tone: "good", text });
      onChange();
      runs.reload();
    } catch (err) {
      setMessage({ tone: "warning", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const hasDemo = meta.accounts.some((a) => a.provider === "demo");

  if (maintenance) return <Maintenance />;

  return (
    <div className="stack">
      {isAdmin && (
        <div className="segmented settings-tabs" role="group" aria-label="Asetukset">
          <button type="button" aria-pressed={!talous} onClick={() => navigate("settings")}>
            Omat
          </button>
          <button type="button" aria-pressed={talous} onClick={() => navigate("settings", { tab: "talous" })}>
            Talous
          </button>
        </div>
      )}

      {talous ? (
        <>
          <Members me={meta.user} onChange={onChange} onLoaded={partLoaded} />
          <ServerSettings focus={section === "server"} onChange={onChange} onLoaded={partLoaded} />
          <SecurityLog />
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Ylläpito</h2>
              </div>
              <a className="btn" href="#/settings?section=maintenance">
                Avaa ylläpito
              </a>
            </div>
          </div>
        </>
      ) : (
        <>
          {message && <div className={`notice ${message.tone}`}>{message.text}</div>}

          <BankConnections meta={meta} pickerOpen={params.get("add") === "1"} onChange={() => { onChange(); runs.reload(); }} onMessage={setMessage} />

          <Accounts meta={meta} onChange={onChange}>
            {qualityNotes}
          </Accounts>

          <Loans meta={meta} onLoaded={loansDone} />

          <Sharing meta={meta} onChange={onChange} />

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
              <div className="form-row" style={{ margin: 0 }}>
                {!hasConnection && <span className="small muted">Lisää ensin pankkiyhteys.</span>}
                <button className="btn" disabled={busy !== null || !hasConnection} onClick={() => run("sync", async () => {
                  const r = await api<{ status: string; inserted: number; messages: string[] }>("/api/sync", { method: "POST" });
                  return [`${plural(r.inserted, "uusi tapahtuma", "uutta tapahtumaa")}.`, ...r.messages].join(" ");
                })}>
                  {busy === "sync" ? "Haetaan…" : "Hae nyt"}
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Aloitettu</th>
                    <th>Tapa</th>
                    <th>Tila</th>
                    <th className="num">Uusia</th>
                    <th>Viesti</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data?.runs.map((r) => (
                    <tr key={r.id}>
                      <td>{dateTime(r.startedAt)}</td>
                      <td>{r.trigger === "schedule" ? "ajastettu" : r.trigger === "connect" ? "uusi yhteys" : "käsin"}</td>
                      <td>{RUN_STATUS[r.status] ?? r.status}</td>
                      <td className="num">{r.inserted}</td>
                      <td className="small muted">{r.message ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {runs.error && <div className="error">{runs.error}</div>}
              {runs.data && !runs.data.runs.length && <div className="empty">Ei hakuja vielä.{hasConnection ? " Paina Hae nyt." : ""}</div>}
            </div>
          </div>

          <Login openPassword={anchor === SETTINGS_ANCHOR.password} />

          {/* only when the household has no shared Enable Banking application, or the member has a key of their own */}
          {meta.bank.source !== "instance" && <BankKey meta={meta} onChange={onChange} />}

          {(meta.accounts.length === 0 || hasDemo) && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Esimerkkitiedot</h2>
                  <div className="card-sub">Kuvitteelliset tapahtumat 14 kuukaudelta.</div>
                </div>
                <div className="form-row" style={{ margin: 0 }}>
                  <button className="btn" disabled={busy !== null} onClick={() => run("demo", async () => { await api("/api/demo", { method: "POST" }); return "Esimerkkitiedot ladattu."; })}>
                    {hasDemo ? "Lataa uudelleen" : "Lataa esimerkkitiedot"}
                  </button>
                  {hasDemo && (
                    <button className="btn btn-danger" disabled={busy !== null} onClick={() => run("demo-del", async () => { await api("/api/demo", { method: "DELETE" }); return "Esimerkkitiedot poistettu."; })}>
                      Poista esimerkkitiedot
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
