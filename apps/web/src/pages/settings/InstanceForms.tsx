/**
 * Instance setup forms (admin), shared by the first-run wizard and
 * Asetukset > Palvelin. The server validates everything again; the checks
 * here only give faster feedback. The time zone and the length of the history
 * are not asked: the form sends the stored values back unchanged.
 */
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { api } from "../../api.ts";
import { setTimeZone } from "../../format.ts";
import type { InstanceSettings, InstanceState } from "../../types.ts";
import "../../styles/settings.css";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";
/**
 * The times of the automatic fetch for each number of fetches a day; the index is the number. The server allows at
 * most four (MAX_SYNCS_PER_DAY). The household picks how many, and the times are spread over the day.
 */
const SYNC_SCHEDULES: readonly (readonly number[])[] = [[], [6], [6, 18], [6, 12, 18], [6, 10, 14, 18]];

const hh = (h: number) => `${h}.15`;

/** "klo 6.15, 18.15" (docs/UI_STYLE.md: a full stop, no zero before the hour). */
export function syncHoursLabel(hours: number[]): string {
  return hours.length ? t("set.iform.at_times", { times: hours.map(hh).join(", ") }) : t("set.iform.no_set_times");
}

/** Same rule as the server (parseBaseUrl): http or https, a host, no path. */
function addressProblem(value: string): string | null {
  const message = t("set.iform.enter_the_address_like_https");
  try {
    const u = new URL(value);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.pathname.replace(/\/+$/, "") || u.search || u.hash) return message;
    return null;
  } catch {
    return value ? message : t("set.iform.enter_the_address");
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

  const plainHttp = /^http:\/\//.test(form.appBaseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$|\/)/.test(form.appBaseUrl);
  // a stored schedule that is not one of the presets keeps its times until the household picks another number
  const setFetchCount = (count: number) => setForm((f) => (f.syncHours.length === count ? f : { ...f, syncHours: [...(SYNC_SCHEDULES[count] ?? [])] }));

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
      setTimeZone(next.settings.timezone);
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
        <span className="field-label">{t("set.iform.app_address")}</span>
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
          <span className="field-error" id="err-address">
            {urlError}
          </span>
        )}
      </label>
      {plainHttp && (
        <Notice tone="warning">{t("set.iform.the_address_is_not_encrypted")}</Notice>
      )}

      <label>
        <span className="field-label">{t("set.iform.fetches_per_day")}</span>
        <select value={form.syncHours.length} onChange={(e) => setFetchCount(Number(e.target.value))}>
          {SYNC_SCHEDULES.map((_, count) => (
            <option key={count} value={count}>
              {count === 0 ? t("set.iform.no_automatic_fetches") : count}
            </option>
          ))}
        </select>
        <span className="field-help">{form.syncHours.length ? t("set.iform.fetch_is_made", { when: syncHoursLabel(form.syncHours) }) : t("set.iform.fetched_when_opened")}</span>
      </label>

      <label className="check">
        <input type="checkbox" checked={form.industryLookup} onChange={(e) => setForm({ ...form, industryLookup: e.target.checked })} />
        <span>
          {t("set.iform.look_up_industry")}
          <span className="field-help">{t("set.iform.only_the_merchant_name")}</span>
        </span>
      </label>

      {error && <Notice tone="error">{error}</Notice>}
      <div className="form-row">
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? t("set.iform.saving") : submitLabel}
        </Button>
        {saved && !error && <span className="small muted">{t("set.iform.saved")}</span>}
        {extraActions}
      </div>
    </form>
  );
}
