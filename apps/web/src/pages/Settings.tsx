import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { ACCOUNT_TYPE_LABEL, date, dateTime, plural } from "../format.ts";
import { useApi } from "../hooks.ts";
import type { AccountType, Meta, SyncRun } from "../types.ts";
import { Accounts } from "./settings/Accounts.tsx";
import { BankConnections, connectedMessage, connectError } from "./settings/BankConnections.tsx";
import { BankKey } from "./settings/BankKey.tsx";
import { syncHoursLabel } from "./settings/InstanceForms.tsx";
import { Maintenance } from "./settings/Maintenance.tsx";
import { Members } from "./settings/Members.tsx";
import { Security } from "./settings/Security.tsx";
import { ServerSettings } from "./settings/Server.tsx";
import { Sharing } from "./settings/Sharing.tsx";
import "../styles/settings.css";

/** Reads a bank export as UTF-8, falling back to Windows-1252 (older Nordea TXT files). */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

const RUN_STATUS: Record<string, string> = { ok: "onnistui", partial: "osittain", failed: "epäonnistui", running: "käynnissä" };

export function Settings({ meta, params, onChange }: { meta: Meta; params: URLSearchParams; onChange: () => void }) {
  const runs = useApi<{ runs: SyncRun[] }>("/api/sync/runs");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "warning"; text: string } | null>(() => {
    const connected = params.get("connected");
    if (connected !== null && /^\d+$/.test(connected)) return connectedMessage(Number(connected));
    const error = params.get("error");
    if (error) return { tone: "warning", text: connectError(error) };
    return null;
  });
  const [csvAccount, setCsvAccount] = useState("");
  const [csvName, setCsvName] = useState("Käyttötili");
  const [csvType, setCsvType] = useState<AccountType>("checking");
  const [csvMessage, setCsvMessage] = useState<{ tone: "good" | "warning"; text: string } | null>(null);
  const csvCard = useRef<HTMLDivElement>(null);
  // a removed account must not stay selected as the import target
  const csvTarget = meta.accounts.some((a) => a.id === csvAccount) ? csvAccount : "";
  const hasConnection = meta.connections.some((c) => c.status === "active");

  // opened from "Tuo CSV" on the empty overview (#/settings?section=csv); once the sync
  // history above it has loaded, so the card does not move away after the scroll
  const scrolledFor = useRef<URLSearchParams | null>(null);
  const runsLoaded = runs.data !== null || runs.error !== null;
  useEffect(() => {
    if (params.get("section") !== "csv" || !runsLoaded || scrolledFor.current === params) return;
    scrolledFor.current = params;
    csvCard.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [params, runsLoaded]);

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

  if (params.get("section") === "security") return <Security me={meta.user} />;
  if (params.get("section") === "maintenance" && meta.user.role === "admin") return <Maintenance />;

  return (
    <div className="stack">
      {message && <div className={`notice ${message.tone}`}>{message.text}</div>}

      <BankConnections meta={meta} pickerOpen={params.get("add") === "1"} onChange={() => { onChange(); runs.reload(); }} onMessage={setMessage} />

      <Accounts meta={meta} onChange={onChange} />

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

      <div className="card" id="csv" ref={csvCard}>
        <div className="card-head">
          <div>
            <h2>Tuo CSV</h2>
            <div className="card-sub">Nordean verkkopankissa Tili &gt; Tapahtumat &gt; Vie tiedostoon (CSV).</div>
          </div>
        </div>
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
            if (!file || busy) return;
            setBusy("csv");
            setCsvMessage(null);
            void (async () => {
              try {
                const content = await readText(file);
                const r = await api<{ inserted: number; skipped: number; updated: number; errors: string[]; firstDate?: string; lastDate?: string; daysOld?: number }>("/api/import/csv", {
                  method: "POST",
                  body: csvTarget ? { content, accountId: csvTarget } : { content, accountName: csvName, accountType: csvType },
                });
                setCsvMessage({ tone: "good", text: [`${plural(r.inserted, "uusi tapahtuma", "uutta tapahtumaa")}, ${r.updated + r.skipped} oli jo tallessa.`,
                    ...(r.firstDate && r.lastDate ? [`Tiedosto kattaa ${date(r.firstDate)}–${date(r.lastDate)}.`] : []),
                    ...(r.daysOld !== undefined && r.daysOld > 7 ? ["Uusin tapahtuma on yli viikon vanha. Vie uusi tiedosto pankista."] : []),
                    ...r.errors,
                  ].join(" ") });
                form.reset();
                onChange();
              } catch (err) {
                // e.g. a name that is already taken: the server says which
                setCsvMessage({ tone: "warning", text: (err as Error).message });
              } finally {
                setBusy(null);
              }
            })();
          }}
        >
          <input type="file" aria-label="CSV-tiedosto" name="file" accept=".csv,.txt,text/csv,text/plain" required />
          <select value={csvTarget} onChange={(e) => setCsvAccount(e.target.value)} aria-label="Tili">
            <option value="">Uusi tili…</option>
            {meta.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {!csvTarget && (
            <>
              <input type="text" value={csvName} onChange={(e) => setCsvName(e.target.value)} aria-label="Tilin nimi" />
              <select value={csvType} onChange={(e) => setCsvType(e.target.value as AccountType)} aria-label="Tilin tyyppi">
                {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy !== null}>
            {busy === "csv" ? "Tuodaan…" : "Tuo"}
          </button>
        </form>
        {csvMessage && <div className={`notice ${csvMessage.tone}`} role="status">{csvMessage.text}</div>}
      </div>

      {meta.user.role === "admin" && <ServerSettings focus={params.get("section") === "server"} onChange={onChange} />}
      {meta.user.role === "admin" && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Ylläpito</h2>
              <div className="card-sub">Päivitykset ja varmuuskopiot</div>
            </div>
            <a className="btn" href="#/settings?section=maintenance">
              Avaa ylläpito
            </a>
          </div>
        </div>
      )}
      {meta.user.role === "admin" && <Members me={meta.user} onChange={onChange} />}
      <BankKey meta={meta} onChange={onChange} />

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Turvallisuus</h2>
            <div className="card-sub">Omat istunnot{meta.user.role === "admin" ? " ja tapahtumaloki" : ""}.</div>
          </div>
          <a className="btn" href="#/settings?section=security">
            Avaa
          </a>
        </div>
      </div>

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
    </div>
  );
}
