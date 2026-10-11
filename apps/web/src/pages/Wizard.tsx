/**
 * First-run setup for the admin, shown after the first account is created
 * until it is finished or skipped: the household's Enable Banking app, done.
 * Address and schedule are saved with their defaults when the wizard opens
 * (the address the admin came in through); all of it stays editable in
 * Asetukset > Palvelin.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { bankLogo } from "../banks.ts";
import { BankLogo } from "../components/BankLogo.tsx";
import { useApi } from "../hooks.ts";
import type { InstanceState, Meta } from "../types.ts";
import { BankAppSetup } from "./settings/BankAppSetup.tsx";
import { syncHoursLabel } from "./settings/InstanceForms.tsx";
import "../styles/wizard.css";

const STEPS = ["Enable Banking", "Valmis"] as const;
const STEP_KEY = "wizard-step";

/** A refresh in the middle of the wizard resumes at the same step. */
function readStep(): number {
  try {
    const n = Number(sessionStorage.getItem(STEP_KEY));
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}

function writeStep(step: number | null): void {
  try {
    if (step === null) sessionStorage.removeItem(STEP_KEY);
    else sessionStorage.setItem(STEP_KEY, String(step));
  } catch {
    // private mode: the wizard starts from the first step after a refresh
  }
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

/**
 * The address to save: the one the admin is using now, unless the installer's address is https (a chosen
 * domain) or the browser came in through localhost (an SSH tunnel, where the real address is the installer's).
 */
export function addressToSave(configured: string, browserOrigin: string): string {
  if (configured.startsWith("https://")) return configured;
  try {
    return LOCAL_HOST.test(new URL(browserOrigin).hostname) ? configured : browserOrigin;
  } catch {
    return configured;
  }
}

export function Wizard({ onDone }: { onDone: (next: "overview" | "connect") => void }) {
  const loaded = useApi<InstanceState>("/api/admin/instance");
  const [state, setState] = useState<InstanceState | null>(null);
  const [step, setStep] = useState(readStep);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState(false);
  const preparing = useRef(false);
  const current = prepared ? (state ?? loaded.data) : null;

  // step 1 of the old wizard: save the defaults at once, so there is nothing to decide before Enable Banking
  useEffect(() => {
    const d = loaded.data;
    if (!d || preparing.current) return;
    preparing.current = true;
    const address = addressToSave(d.settings.appBaseUrl, window.location.origin);
    if (address === d.settings.appBaseUrl) return setPrepared(true);
    const { appBaseUrl: _old, setupDone: _done, ...rest } = d.settings;
    api<InstanceState>("/api/admin/instance", { method: "PUT", body: { ...rest, appBaseUrl: address } })
      .then(setState)
      .catch((err: Error) => setError(`Osoitetta ei voitu tallentaa: ${err.message} Muuta se kohdassa Asetukset > Palvelin.`))
      .finally(() => setPrepared(true));
  }, [loaded.data]);

  // an error belongs to the step where it happened
  const goTo = (next: number) => {
    setError(null);
    setStep(next);
    writeStep(next);
    window.scrollTo({ top: 0 });
  };

  const finish = async (next: "overview" | "connect") => {
    if (finishing) return;
    setFinishing(true);
    setError(null);
    try {
      await api("/api/admin/instance/complete", { method: "POST" });
      writeStep(null);
      onDone(next);
    } catch (err) {
      setError((err as Error).message);
      setFinishing(false);
    }
  };

  return (
    <div className="wizard-wrap">
      <div className="card wizard">
        <div className="wizard-head">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <i style={{ height: 6 }} />
              <i style={{ height: 10 }} />
              <i style={{ height: 13 }} />
            </span>
            Omatalous
          </div>
          <button className="btn btn-small" type="button" disabled={finishing} onClick={() => void finish("overview")}>
            Tee myöhemmin
          </button>
        </div>
        <h1 className="auth-title">Käyttöönotto</h1>
        <p className="muted">Kaiken voi muuttaa myöhemmin kohdassa Asetukset &gt; Palvelin.</p>

        <ol className="wizard-steps" aria-label="Vaiheet">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : undefined}>
              <span className="step-no">{i + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {error && <div className="error">{error}</div>}
        {!current ? (
          loaded.error ? (
            <div className="notice warning">
              {loaded.error}{" "}
              <button className="btn btn-small" type="button" onClick={loaded.reload}>
                Yritä uudelleen
              </button>
            </div>
          ) : (
            <div className="empty">Ladataan…</div>
          )
        ) : step === 0 ? (
          <>
            <p className="small muted">Yksi sovellus riittää koko taloudelle. Omien tilien käyttö on maksutonta.</p>
            <BankAppSetup state={current} onState={setState} />
            <div className="form-row wizard-nav">
              <span className="spacer" />
              <button className={current.bankApp.source ? "btn btn-primary" : "btn"} type="button" onClick={() => goTo(1)}>
                {current.bankApp.source ? "Jatka" : "Ohita vaihe"}
              </button>
            </div>
          </>
        ) : (
          <>
            <dl className="summary">
              <dt>Osoite</dt>
              <dd>{current.settings.appBaseUrl}</dd>
              <dt>Aikavyöhyke</dt>
              <dd>{current.settings.timezone}</dd>
              <dt>Automaattinen haku</dt>
              <dd>{syncHoursLabel(current.settings.syncHours)}</dd>
              <dt>Enable Banking</dt>
              <dd>
                {!current.bankApp.source ? (
                  <span className="badge warn">ei vielä</span>
                ) : current.bankApp.inactiveMessage ? (
                  <span className="badge warn">ei aktiivinen</span>
                ) : (
                  <span className="badge good">määritetty</span>
                )}
              </dd>
              <dt>Salausavain</dt>
              <dd>{current.secret.available ? <span className="badge good">kunnossa</span> : <span className="badge warn">puuttuu</span>}</dd>
            </dl>
            {current.bankApp.inactiveMessage && <div className="notice warning">{current.bankApp.inactiveMessage}</div>}
            <div className="form-row wizard-nav">
              <button className="btn" type="button" onClick={() => goTo(0)}>
                Takaisin
              </button>
              <span className="spacer" />
              <button className="btn" type="button" disabled={finishing} onClick={() => void finish("overview")}>
                Siirry sovellukseen
              </button>
              {current.bankApp.source && (
                <button className="btn btn-primary btn-with-logo" type="button" disabled={finishing || !!current.bankApp.inactiveMessage} onClick={() => void finish("connect")}>
                  <BankLogo src={bankLogo("nordea-fi")} name="Nordea" size="sm" />
                  Lisää pankkiyhteys
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
