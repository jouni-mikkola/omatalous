/** Asetukset > Kaksivaiheinen kirjautuminen: turn the authenticator code on and off, make new recovery codes. */
import { useState } from "react";
import { api } from "../../api.ts";
import { copyText } from "../../clipboard.ts";
import { date, dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { CopyValue } from "./CopyValue.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";
import { useAction } from "./use-action.ts";
interface FactorState {
  enabled: boolean;
  since: string | null;
  lastUsedAt: string | null;
  recoveryLeft: number;
}

/** The secret in groups of four, as authenticator apps print it for typing in. */
function groupsOfFour(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

/** The ten recovery codes: shown once, with a button that copies them all. */
export function RecoveryCodes({
  codes,
  onDone,
}: {
  codes: string[];
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-box" role="status">
      <strong>{t("set.fac.recovery_codes")}</strong>
      <ul className="recovery-codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="small">{t("set.fac.the_codes_are_shown_only")}</div>
      <div className="form-row">
        <Button
          
          onClick={async () => {
            if (await copyText(codes.join("\n"))) setCopied(true);
          }}
        >
          {copied ? t("set.fac.copied") : t("set.fac.copy_codes")}
        </Button>
        <Button
          variant="primary"
          onClick={onDone}
        >
          {t("set.fac.done")}
        </Button>
      </div>
    </div>
  );
}

/** Password and one code (from the app, or a recovery code), for the actions that need both. */
function PasswordAndCode({
  submitLabel,
  danger,
  onSubmit,
  onCancel,
}: {
  submitLabel: string;
  danger?: boolean;
  onSubmit: (password: string, code: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const { error, busy, run } = useAction();
  return (
    <form className="auth-form" onSubmit={run(() => onSubmit(password, code))}>
      <label>
        {t("set.fac.password")}
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
        />
      </label>
      <label>
        {t("set.fac.code_from_the_app_or")}
        <input
          type="text"
          name="code"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="form-row">
        <Button variant="primary" danger={danger} type="submit" busy={busy}>
          {submitLabel}
        </Button>
        <Button onClick={onCancel}>
          {t("set.fac.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Turning on: the password, then the secret to type into the app and the first code it shows. */
function TurnOn({
  onDone,
  onCancel,
}: {
  onDone: (codes: string[]) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [started, setStarted] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const { error, busy, run } = useAction();
  const buttons = (label: string) => (
    <div className="form-row">
      <Button
        variant="primary"
        type="submit"
        busy={busy}
      >
        {label}
      </Button>
      <Button onClick={onCancel}>
        {t("set.fac.cancel")}
      </Button>
    </div>
  );
  if (!started) {
    return (
      <form
        className="auth-form"
        onSubmit={run(async () =>
          setStarted(
            await api<{ secret: string; uri: string }>(
              "/api/security/factor/enrol",
              { method: "POST", body: { password } },
            ),
          ),
        )}
      >
        <label>
          {t("set.fac.password")}
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        {buttons(t("set.fac.continue"))}
      </form>
    );
  }
  return (
    <form
      className="auth-form"
      onSubmit={run(async () =>
        onDone(
          (
            await api<{ recoveryCodes: string[] }>(
              "/api/security/factor/confirm",
              { method: "POST", body: { password, code } },
            )
          ).recoveryCodes,
        ),
      )}
    >
      <div>
        <div className="small">{t("set.fac.key")}</div>
        <div data-testid="factor-secret">
          <CopyValue value={groupsOfFour(started.secret)} label={t("set.fac.key_2")} />
        </div>
        <a href={started.uri}>{t("set.fac.open_in_the_app")}</a>
      </div>
      <label>
        {t("set.fac.code_from_the_app")}
        <input
          type="text"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          autoFocus
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      {buttons(t("set.fac.turn_on"))}
    </form>
  );
}

/** The one line the card says while the factor is on: since when, the last use and the recovery codes left. */
export const factLine = (f: { since?: string | null; lastUsedAt?: string | null; recoveryLeft: number }): string =>
  [
    f.since ? t("set.fac.in_use_since", { date: date(f.since) }) : t("set.fac.in_use"),
    f.lastUsedAt ? t("set.fac.last_used", { time: dateTime(f.lastUsedAt) }) : t("set.fac.not_used_yet"),
    t("set.fac.codes_left", { count: f.recoveryLeft }),
  ].join(", ") + ".";

export function SecondFactor() {
  const factor = useApi<FactorState>("/api/security/factor");
  const [mode, setMode] = useState<"on" | "off" | "new" | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const close = () => {
    setMode(null);
    setCodes(null);
    factor.reload();
  };
  const f = factor.data;
  return (
    <div className="card half">
      <div className="card-head">
        <div>
          <h2>{t("set.fac.two_step_sign_in")}</h2>
        </div>
        {f && !mode && !codes && (
          <div className="form-row flush">
            {f.enabled ? (
              <>
                <Button
                  
                  onClick={() => setMode("new")}
                >
                  {t("set.fac.make_new_recovery_codes")}
                </Button>
                <Button
                  
                  onClick={() => setMode("off")}
                >
                  {t("set.fac.turn_off")}
                </Button>
              </>
            ) : (
              <Button
                
                onClick={() => setMode("on")}
              >
                {t("set.fac.turn_on")}
              </Button>
            )}
          </div>
        )}
      </div>
      {factor.error && <Notice tone="error">{factor.error}</Notice>}
      {f && !codes && !f.enabled && <p className="muted">{t("set.fac.not_in_use")}</p>}
      {f && !codes && f.enabled && <p>{factLine(f)}</p>}
      {codes && <RecoveryCodes codes={codes} onDone={close} />}
      {!codes && mode === "on" && <TurnOn onDone={setCodes} onCancel={close} />}
      {!codes && mode === "off" && (
        <PasswordAndCode
          submitLabel={t("set.fac.turn_off")}
          danger
          onCancel={close}
          onSubmit={async (password, code) => {
            await api("/api/security/factor/remove", {
              method: "POST",
              body: { password, code },
            });
            close();
          }}
        />
      )}
      {!codes && mode === "new" && (
        <PasswordAndCode
          submitLabel={t("set.fac.make_new_codes")}
          onCancel={close}
          onSubmit={async (password, code) =>
            setCodes(
              (
                await api<{ recoveryCodes: string[] }>(
                  "/api/security/factor/recovery-codes",
                  { method: "POST", body: { password, code } },
                )
              ).recoveryCodes,
            )
          }
        />
      )}
    </div>
  );
}
