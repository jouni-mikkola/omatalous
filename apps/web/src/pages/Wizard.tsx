/**
 * First-run setup for the admin, shown after the first account is created
 * until it is finished or closed with "Do this later" (remembered per user in this browser; the same setup is in Settings > Banks and accounts; the page shows these in the household's language): the household's Enable Banking app, done.
 * Address and schedule are saved with their defaults when the wizard opens
 * (the address the admin came in through); all of it stays editable in
 * Asetukset > Palvelin.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { t } from "../text.ts";
import { useApi } from "../hooks.ts";
import { bankLinked } from "../components/EmptyStart.tsx";
import type { InstanceState, Meta } from "../types.ts";
import { wizardDue } from "../wizard-due.ts";
import { BankAppSetup } from "./settings/BankAppSetup.tsx";
import { syncHoursLabel } from "./settings/InstanceForms.tsx";
import "../styles/wizard.css";
import { Button } from "../components/ui/Button.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Empty } from "../components/ui/Empty.tsx";
const STEP_COUNT = 2;
const STEP_KEY = "wizard-step";

/** A refresh in the middle of the wizard resumes at the same step. */
function readStep(): number {
  try {
    const n = Number(sessionStorage.getItem(STEP_KEY));
    return Number.isInteger(n) && n >= 0 && n < STEP_COUNT ? n : 0;
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

/**
 * The last step: what was set up, and where to go next. Yhdistä pankki stays on while the app reads Inactive:
 * starting a connection tests the app again and says what is wrong (`stillInactive` in connectors/enable-banking/link.ts).
 */
export function WizardDone({ current, linked, finishing, onBack, onFinish }: { current: InstanceState; linked: boolean; finishing: boolean; onBack: () => void; onFinish: (next: "overview" | "connect") => void }) {
  return (
    <>
      <dl className="summary">
        <dt>{t("set.wizard.address")}</dt>
        <dd>{current.settings.appBaseUrl}</dd>
        <dt>{t("set.wizard.timezone")}</dt>
        <dd>{current.settings.timezone}</dd>
        <dt>{t("set.wizard.auto_fetch")}</dt>
        <dd>{syncHoursLabel(current.settings.syncHours)}</dd>
        <dt>Enable Banking</dt>
        <dd>
          {!current.bankApp.source ? (
            <span className="badge warn">{t("set.wizard.not_yet")}</span>
          ) : current.bankApp.inactiveMessage ? (
            <span className="badge warn">{t("set.wizard.not_active")}</span>
          ) : (
            <span className="badge good">{t("set.wizard.configured")}</span>
          )}
        </dd>
        <dt>{t("set.wizard.encryption_key")}</dt>
        <dd>{current.secret.available ? <span className="badge good">{t("set.wizard.key_ok")}</span> : <span className="badge warn">{t("set.wizard.key_missing")}</span>}</dd>
      </dl>
      {current.bankApp.inactiveMessage && <Notice tone="warning">{current.bankApp.inactiveMessage}</Notice>}
      {linked ? (
        <Notice tone="good" as="p">{t("set.wizard.done_linked")}</Notice>
      ) : (
        <Notice tone="warning" as="p">
          {current.bankApp.source ? t("set.wizard.bank_missing") : t("set.wizard.app_and_bank_missing")}
        </Notice>
      )}
      <div className="form-row wizard-nav">
        <Button onClick={onBack}>
          {t("set.wizard.back")}
        </Button>
        <span className="spacer" />
        <Button variant={current.bankApp.source ? "secondary" : "primary"} busy={finishing} onClick={() => onFinish("overview")}>
          {t("set.wizard.to_app")}
        </Button>
        {current.bankApp.source && (
          <Button variant="primary" busy={finishing} onClick={() => onFinish("connect")}>
            {t("set.wizard.connect_bank")}
          </Button>
        )}
      </div>
    </>
  );
}

/**
 * "Tee myöhemmin" closes the wizard and the shell remembers it for this user in this browser. Nothing is written to the
 * server, so setupDone stays false until the setup is finished from the last step.
 */
export function WizardSkip({ disabled, onSkip }: { disabled: boolean; onSkip: () => void }) {
  return (
    <Button variant="link" busy={disabled} onClick={onSkip}>
      {t("set.wizard.later")}
    </Button>
  );
}

export function Wizard({ meta, onDone, onSkip }: { meta: Meta; onDone: (next: "overview" | "connect") => void; onSkip: () => void }) {
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
      .catch((err: Error) => setError(t("set.wizard.address_not_saved", { message: err.message })))
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
    <main className="wizard-wrap">
      <div className="card wizard">
        <div className="card-head wizard-head">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            Omatalous
          </div>
          <ol className="wizard-steps" aria-label={t("set.wizard.steps")}>
            {["Enable Banking", t("set.wizard.review")].map((label, i) => (
              <li key={label} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : undefined}>
                <span className="step-no">{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <WizardSkip
            disabled={finishing}
            onSkip={() => {
              writeStep(null);
              onSkip();
            }}
          />
        </div>
        <h1 className="auth-title">{t("set.wizard.title")}</h1>

        {error && <Notice tone="error">{error}</Notice>}
        {!current ? (
          loaded.error ? (
            <ErrorCard message={loaded.error} onRetry={loaded.reload} />
          ) : (
            <Empty>{t("set.wizard.loading")}</Empty>
          )
        ) : step === 0 ? (
          <>
            <p className="small muted">{t("set.wizard.intro")}</p>
            <BankAppSetup state={current} onState={setState} />
            <p className="small muted">{t("set.wizard.where_settings")}</p>
            <div className="form-row wizard-nav">
              <span className="spacer" />
              <Button variant={current.bankApp.source ? "primary" : "secondary"} onClick={() => goTo(1)}>
                {t("set.wizard.continue")}
              </Button>
            </div>
          </>
        ) : (
          <WizardDone current={current} linked={bankLinked(meta)} finishing={finishing} onBack={() => goTo(0)} onFinish={(next) => void finish(next)} />
        )}
      </div>
    </main>
  );
}

/**
 * What App shows before the pages: the wizard for an admin of an install whose setup is not finished and who has not
 * closed it in this browser (remembered), else null. "Tee myöhemmin" only calls `close`; finishing also reloads meta.
 */
export function firstRunWizard(o: { role: string; meta: Meta; closed: boolean; close: () => void; reloadMeta: () => void; goToSettings: () => void }) {
  if (!wizardDue(o)) return null;
  return (
    <Wizard
      meta={o.meta}
      onSkip={o.close}
      onDone={(next) => {
        o.close();
        o.reloadMeta();
        if (next === "connect") o.goToSettings();
      }}
    />
  );
}
