/**
 * Instance setup forms (admin), shared by the first-run wizard and
 * Asetukset > Palvelin. The server validates everything again; the checks
 * here only give faster feedback.
 */
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { api } from "../../api.ts";
import type { InstanceSettings, InstanceState } from "../../types.ts";
import "../../styles/settings.css";

const HISTORY_OPTIONS = [
  [90, "3 kuukautta"],
  [180, "6 kuukautta"],
  [365, "1 vuosi"],
  [730, "2 vuotta"],
] as const;
const MAX_SYNCS = 4;

function timeZones(): string[] {
  const all = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["Europe/Helsinki", "Europe/Stockholm", "UTC"];
  // the household's own zone first
  return ["Europe/Helsinki", ...all.filter((z) => z !== "Europe/Helsinki")];
}

const hh = (h: number) => `${String(h).padStart(2, "0")}.15`;

export function syncHoursLabel(hours: number[]): string {
  return hours.length ? hours.map(hh).join(", ") : "vain käsin";
}

/** Same rule as the server (parseBaseUrl): http or https, a host, no path. */
function addressProblem(value: string): string | null {
  const message = "Anna osoite muodossa https://talous.oma.fi (ilman polkua).";
  try {
    const u = new URL(value);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.pathname.replace(/\/+$/, "") || u.search || u.hash) return message;
    return null;
  } catch {
    return value ? message : "Anna osoite.";
  }
}

// ── address, time zone, schedule ─────────────────────────

export function GeneralForm({
  state,
  initialAddress,
  submitLabel,
  onSaved,
  extraActions,
}: {
  state: InstanceState;
  /** The wizard suggests the address the admin is using right now. */
  initialAddress?: string;
  submitLabel: string;
  onSaved: (next: InstanceState) => void;
  extraActions?: ReactNode;
}) {
  const [form, setForm] = useState<Omit<InstanceSettings, "setupDone">>(() => ({
    appBaseUrl: initialAddress ?? state.settings.appBaseUrl,
    timezone: state.settings.timezone,
    syncHours: state.settings.syncHours,
    historyDays: state.settings.historyDays,
    industryLookup: state.settings.industryLookup,
  }));
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const zones = useMemo(timeZones, []);

  const plainHttp = /^http:\/\//.test(form.appBaseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$|\/)/.test(form.appBaseUrl);
  const toggleHour = (h: number) =>
    setForm((f) => ({ ...f, syncHours: f.syncHours.includes(h) ? f.syncHours.filter((x) => x !== h) : [...f.syncHours, h].sort((a, b) => a - b) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setSaved(false);
    const problem = addressProblem(form.appBaseUrl);
    if (problem) {
      setUrlError(problem);
      urlInput.current?.focus();
      return;
    }
    setUrlError(null);
    setBusy(true);
    try {
      const next = await api<InstanceState>("/api/admin/instance", { method: "PUT", body: form });
      setSaved(true);
      onSaved(next);
    } catch (err) {
      const message = (err as Error).message;
      // the server's address message belongs next to the address field
      if (/^Anna osoite/.test(message)) {
        setUrlError(message);
        urlInput.current?.focus();
      } else setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="setup-form" onSubmit={submit} noValidate>
      <label>
        <span className="field-label">Sovelluksen osoite</span>
        <input
          ref={urlInput}
          type="url"
          value={form.appBaseUrl}
          onChange={(e) => {
            setForm({ ...form, appBaseUrl: e.target.value.trim() });
            setUrlError(null);
          }}
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? "err-address" : undefined}
          maxLength={200}
          placeholder="https://talous.oma.fi"
          spellCheck={false}
          autoComplete="off"
        />
        {urlError && (
          <span className="error" id="err-address">
            {urlError}
          </span>
        )}
      </label>
      {plainHttp && (
        <div className="notice warning">Yhteys ei ole salattu. Käytä HTTPS:ää, jos sovellukseen pääsee kotiverkon ulkopuolelta.</div>
      )}

      <div className="field-grid">
        <label>
          <span className="field-label">Aikavyöhyke</span>
          <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Haettava historia</span>
          <select value={form.historyDays} onChange={(e) => setForm({ ...form, historyDays: Number(e.target.value) })}>
            {HISTORY_OPTIONS.map(([days, label]) => (
              <option key={days} value={days}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="hour-picker">
        <legend className="field-label">
          Automaattinen haku <span className="muted">({syncHoursLabel(form.syncHours)})</span>
        </legend>
        <div className="hours" role="group" aria-label="Hakuajat">
          {Array.from({ length: 24 }, (_, h) => {
            const on = form.syncHours.includes(h);
            return (
              <button key={h} type="button" aria-pressed={on} disabled={!on && form.syncHours.length >= MAX_SYNCS} onClick={() => toggleHour(h)} aria-label={`klo ${hh(h)}`}>
                {String(h).padStart(2, "0")}
              </button>
            );
          })}
        </div>
        <span className="field-help">Enintään {MAX_SYNCS} kertaa päivässä.</span>
      </fieldset>

      <label className="check">
        <input type="checkbox" checked={form.industryLookup} onChange={(e) => setForm({ ...form, industryLookup: e.target.checked })} />
        <span>
          Hae tuntemattomien kauppiaiden toimiala YTJ:stä
          <span className="field-help">YTJ:hin lähetetään vain kauppiaan nimi.</span>
        </span>
      </label>

      {error && <div className="error">{error}</div>}
      <div className="form-row">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Tallennetaan…" : submitLabel}
        </button>
        {saved && !error && <span className="small muted">Tallennettu.</span>}
        {extraActions}
      </div>
    </form>
  );
}
