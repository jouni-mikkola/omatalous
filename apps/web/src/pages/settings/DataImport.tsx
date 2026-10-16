import { useRef, useState } from "react";
import { api } from "../../api.ts";

/** One store of the dry run's answer (docs/DATA_EXPORT.md, "The dry run's answer"). */
type StorePlan = { key: string; add: number; exists: number; skipped: { reason: string; n: number }[] };
type Totals = { add: number; exists: number; skipped: number };
type Plan = { session: string; stores: StorePlan[]; total: Totals; committed: boolean };

/** The server sends the keys of the file's stores only. */
const STORE_LABELS: Record<string, string> = {
  users: "Käyttäjät",
  accounts: "Tilit",
  accountShares: "Tilien jakaminen",
  transactions: "Tapahtumat",
  rules: "Säännöt",
  marks: "Merkinnät",
  answers: "Omistajavastaukset",
  accountSplits: "Tilien jaot",
  accountUse: "Tilien käyttö",
  parts: "Tapahtumien osat",
  loans: "Lainat",
  expectedBills: "Odotetut laskut",
  optimiseInputs: "Optimoinnin lähtötiedot",
  optimiseStates: "Optimoinnin tilat",
  optimiseSnapshots: "Optimoinnin tallenteet",
  accountBalances: "Tilien saldot",
  accountHistory: "Tilien historia",
  statementBills: "Korttilaskut",
  statementRows: "Korttilaskujen rivit",
  foreignRows: "Ulkomaiset rivit",
  payerRoles: "Maksajien roolit",
  householdMembers: "Talouden jäsenet",
  accountAgreements: "Tilien sopimukset",
  valuedAssets: "Arvotettu omaisuus",
  contractTerms: "Sopimusehdot",
};

const REASONS: Record<string, string> = {
  other_user: "toisen käyttäjän",
  users: "ei tuoda",
  sharing: "ei tuoda",
  household: "ei tuoda: vain ylläpitäjä tuo talouden yhteiset tiedot",
  refused: "Ei tuotu: ei täsmää tai kuukausi ei ole päättynyt",
};

const NOT_OURS = "Tiedosto ei ole Omatalouden tietotiedosto.";
const HEAD_KEYS = ["format", "version", "appVersion", "exportedAt", "exportedBy"] as const;

type Chunk = { seq: number; stores: Record<string, unknown[]> };

/** Splits the arrays of the file into chunks of at most `limit` bytes of JSON; a row over the limit goes alone, the server refuses it. */
function chunks(file: Record<string, unknown>, limit: number): Chunk[] {
  const encoder = new TextEncoder();
  const out: Chunk[] = [];
  let stores: Record<string, unknown[]> = {};
  let size = 0;
  const flush = () => {
    if (Object.keys(stores).length > 0) out.push({ seq: out.length, stores });
    stores = {};
    size = 0;
  };
  for (const [key, rows] of Object.entries(file)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const bytes = encoder.encode(JSON.stringify(row)).length + 1;
      // the key and its brackets are counted once per chunk; the margin below the server's cap covers the rest
      if (size > 0 && size + bytes + key.length + 8 > limit) flush();
      const list = (stores[key] ??= []);
      size += bytes + (list.length === 0 ? key.length + 8 : 0);
      list.push(row);
    }
  }
  flush();
  return out;
}

const counts = (t: Totals, done: boolean) =>
  done ? `lisätty ${t.add}, jo olemassa ${t.exists}, ohitettu ${t.skipped}` : `lisätään ${t.add}, jo olemassa ${t.exists}, ohitetaan ${t.skipped}`;

function storeLine(s: StorePlan): string {
  const skipped = s.skipped.reduce((n, r) => n + r.n, 0);
  const why = [...new Set(s.skipped.map((r) => REASONS[r.reason] ?? r.reason))];
  return `${counts({ add: s.add, exists: s.exists, skipped }, false)}${why.length > 0 ? ` (${why.join(", ")})` : ""}`;
}

/**
 * Asetukset > Tiedot > "Tuo tiedot": reads the file of "Vie kaikki tiedot", stages it on the server, shows the dry run and
 * commits on "Tuo". It sits in the card head beside the export button; what it prints wraps to its own lines.
 */
export function DataImport() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [done, setDone] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    setPlan(null);
    setDone(null);
    try {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(await file.text()) as Record<string, unknown>;
      } catch {
        throw new Error(NOT_OURS);
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error(NOT_OURS);
      const head = Object.fromEntries(HEAD_KEYS.map((k) => [k, body[k]]));
      const started = await api<{ session: string; limits: { chunkBytes: number } }>("/api/data/import", { method: "POST", body: head });
      const parts = chunks(body, started.limits.chunkBytes);
      for (const part of parts) {
        setProgress({ at: part.seq + 1, of: parts.length });
        await api(`/api/data/import/${started.session}/chunk`, { method: "POST", body: part });
      }
      setPlan(await api<Plan>(`/api/data/import/${started.session}/check`, { method: "POST" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const commit = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api<Plan>(`/api/data/import/${plan.session}/commit`, { method: "POST" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPlan(null);
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!plan) return;
    setBusy(true);
    setCancelling(true);
    try {
      await api(`/api/data/import/${plan.session}`, { method: "DELETE" });
    } catch {
      // the session ends by itself after fifteen minutes
    }
    setPlan(null);
    setBusy(false);
    setCancelling(false);
  };

  return (
    <>
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
      <button type="button" className="btn" disabled={busy || plan !== null} aria-busy={busy} onClick={() => input.current?.click()}>
        Tuo tiedot
      </button>
      {progress && (
        <div className="data-import-line">
          <progress value={progress.at} max={progress.of} aria-label="Tuonti" /> Osa {progress.at} / {progress.of}
        </div>
      )}
      {plan && (
        <div className="data-import-line">
          <table className="data-import-plan">
            <tbody>
              {plan.stores.map((s) => (
                <tr key={s.key}>
                  <th scope="row">{STORE_LABELS[s.key] ?? s.key}</th>
                  <td className="num">{storeLine(s)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Yhteensä</th>
                <td className="num">{counts(plan.total, false)}</td>
              </tr>
            </tbody>
          </table>
          <div className="data-import-actions">
            <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={() => void commit()}>
              Tuo
            </button>
            <button type="button" className="btn" disabled={busy} aria-busy={busy && cancelling} onClick={() => void cancel()}>
              Peruuta
            </button>
          </div>
        </div>
      )}
      {done && (
        <div className="data-import-line" role="status">
          <strong>Tiedot tuotu</strong>: {counts(done.total, true)}
        </div>
      )}
      {error && <div className="error data-import-line">{error}</div>}
    </>
  );
}
