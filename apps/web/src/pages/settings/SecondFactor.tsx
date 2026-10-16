/** Asetukset > Kaksivaiheinen kirjautuminen: turn the authenticator code on and off, make new recovery codes. */
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { copyText } from "../../clipboard.ts";
import { date, dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { CopyValue } from "./CopyValue.tsx";

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
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-box" role="status">
      <strong>Palautuskoodit</strong>
      <ul className="recovery-codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="small">Koodit näytetään vain nyt.</div>
      <div className="form-row">
        <button
          className="btn btn-small"
          type="button"
          onClick={async () => {
            if (await copyText(codes.join("\n"))) setCopied(true);
          }}
        >
          {copied ? "Kopioitu" : "Kopioi koodit"}
        </button>
        <button className="btn btn-primary btn-small" type="button" onClick={onDone}>
          Valmis
        </button>
      </div>
    </div>
  );
}

/** Runs a form's action with a busy flag and the server's sentence as the error. */
function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

/** Password and one code (from the app, or a recovery code), for the actions that need both. */
function PasswordAndCode({ submitLabel, danger, onSubmit, onCancel }: { submitLabel: string; danger?: boolean; onSubmit: (password: string, code: string) => Promise<void>; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const { error, busy, run } = useAction();
  return (
    <form className="auth-form" onSubmit={run(() => onSubmit(password, code))}>
      <label>
        Salasana
        <input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
      </label>
      <label>
        Koodi sovelluksesta tai palautuskoodi
        <input type="text" name="code" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      {error && <div className="error">{error}</div>}
      <div className="form-row">
        <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} type="submit" disabled={busy} aria-busy={busy || undefined}>
          {submitLabel}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Peruuta
        </button>
      </div>
    </form>
  );
}

/** Turning on: the password, then the secret to type into the app and the first code it shows. */
function TurnOn({ onDone, onCancel }: { onDone: (codes: string[]) => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [started, setStarted] = useState<{ secret: string; uri: string } | null>(null);
  const { error, busy, run } = useAction();
  const buttons = (label: string) => (
    <div className="form-row">
      <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
        {label}
      </button>
      <button className="btn" type="button" onClick={onCancel}>
        Peruuta
      </button>
    </div>
  );
  if (!started) {
    return (
      <form className="auth-form" onSubmit={run(async () => setStarted(await api<{ secret: string; uri: string }>("/api/security/factor/enrol", { method: "POST", body: { password } })))}>
        <label>
          Salasana
          <input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </label>
        {error && <div className="error">{error}</div>}
        {buttons("Jatka")}
      </form>
    );
  }
  return (
    <form className="auth-form" onSubmit={run(async () => onDone((await api<{ recoveryCodes: string[] }>("/api/security/factor/confirm", { method: "POST", body: { password, code } })).recoveryCodes))}>
      <div>
        <div className="small">Avain</div>
        <div data-testid="factor-secret">
          <CopyValue value={groupsOfFour(started.secret)} label="avain" />
        </div>
        <a href={started.uri}>Avaa sovelluksessa</a>
      </div>
      <label>
        Koodi sovelluksesta
        <input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
      </label>
      {error && <div className="error">{error}</div>}
      {buttons("Ota käyttöön")}
    </form>
  );
}

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
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Kaksivaiheinen kirjautuminen</h2>
        </div>
        {f && !mode && !codes && (
          <div className="form-row" style={{ margin: 0 }}>
            {f.enabled ? (
              <>
                <button className="btn" type="button" onClick={() => setMode("new")}>
                  Luo uudet palautuskoodit
                </button>
                <button className="btn btn-danger" type="button" onClick={() => setMode("off")}>
                  Poista käytöstä
                </button>
              </>
            ) : (
              <button className="btn" type="button" onClick={() => setMode("on")}>
                Ota käyttöön
              </button>
            )}
          </div>
        )}
      </div>
      {factor.error && <div className="error">{factor.error}</div>}
      {f && !codes && (
        <table className="ruled">
          <tbody>
            <tr>
              <td>Tila</td>
              <td className="num">{f.enabled ? "Käytössä" : "Ei käytössä"}</td>
            </tr>
            {f.enabled && f.since && (
              <tr>
                <td>Käytössä alkaen</td>
                <td className="num">{date(f.since)}</td>
              </tr>
            )}
            {f.enabled && (
              <tr>
                <td>Viimeksi käytetty</td>
                <td className="num">{f.lastUsedAt ? dateTime(f.lastUsedAt) : "–"}</td>
              </tr>
            )}
            {f.enabled && (
              <tr>
                <td>Palautuskoodeja jäljellä</td>
                <td className="num">{f.recoveryLeft}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {codes && <RecoveryCodes codes={codes} onDone={close} />}
      {!codes && mode === "on" && <TurnOn onDone={setCodes} onCancel={close} />}
      {!codes && mode === "off" && (
        <PasswordAndCode
          submitLabel="Poista käytöstä"
          danger
          onCancel={close}
          onSubmit={async (password, code) => {
            await api("/api/security/factor/remove", { method: "POST", body: { password, code } });
            close();
          }}
        />
      )}
      {!codes && mode === "new" && (
        <PasswordAndCode
          submitLabel="Luo uudet koodit"
          onCancel={close}
          onSubmit={async (password, code) => setCodes((await api<{ recoveryCodes: string[] }>("/api/security/factor/recovery-codes", { method: "POST", body: { password, code } })).recoveryCodes)}
        />
      )}
    </div>
  );
}
