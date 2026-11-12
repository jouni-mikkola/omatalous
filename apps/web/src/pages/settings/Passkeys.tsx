/** Asetukset > Turvallisuus: the passkeys of the signed-in member, to add and to remove. */
import { useState } from "react";
import { api } from "../../api.ts";
import { dateTime } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { Empty } from "../../components/ui/Empty.tsx";
import { t } from "../../text.ts";
import { useAction } from "./use-action.ts";
import { type CreationOptions, createPasskey, passkeysSupported } from "../../webauthn.ts";
import { RecoveryCodes } from "./SecondFactor.tsx";

interface PasskeyState {
  usable: boolean;
  address: string;
  enabled: boolean;
  passkeys: { id: string; label: string; createdAt: string; lastUsedAt: string | null }[];
}

const Password = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <label>
    {t("passkey.password")}
    <input type="password" name="password" autoComplete="current-password" value={value} onChange={(e) => onChange(e.target.value)} required autoFocus />
  </label>
);

/** The code of an existing second factor: the server asks for it before it changes the passkeys. */
const Code = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <label>
    {t("passkey.code")}
    <input type="text" name="code" autoComplete="one-time-code" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} required />
  </label>
);

function Add({ needCode, onDone, onCancel }: { needCode: boolean; onDone: (codes: string[]) => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const { error, busy, run } = useAction();
  const [cancelled, setCancelled] = useState(false);
  return (
    <form
      className="auth-form"
      onSubmit={run(async () => {
        setCancelled(false);
        const options = await api<CreationOptions>("/api/security/factor/passkey/start", { method: "POST", body: { password, code } });
        const response = await createPasskey(options);
        if (!response) return setCancelled(true);
        const done = await api<{ recoveryCodes: string[] }>("/api/security/factor/passkey/finish", { method: "POST", body: { response, label } });
        onDone(done.recoveryCodes);
      })}
    >
      <Password value={password} onChange={setPassword} />
      {needCode && <Code value={code} onChange={setCode} />}
      <label>
        {t("passkey.device")}
        <input type="text" name="label" autoComplete="off" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} required />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      {cancelled && <Notice tone="error">{t("passkey.cancelled")}</Notice>}
      <div className="form-row">
        <Button variant="primary" type="submit" busy={busy}>
          {t("passkey.add")}
        </Button>
        <Button onClick={onCancel}>{t("form.cancel")}</Button>
      </div>
    </form>
  );
}

function Remove({ id, label, needCode, onDone, onCancel }: { id: string; label: string; needCode: boolean; onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const { error, busy, run } = useAction();
  return (
    <form
      className="auth-form"
      aria-label={t("passkey.remove_named", { name: label })}
      onSubmit={run(async () => {
        await api("/api/security/factor/passkey/remove", { method: "POST", body: { password, code, id } });
        onDone();
      })}
    >
      <Password value={password} onChange={setPassword} />
      {needCode && <Code value={code} onChange={setCode} />}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="form-row">
        <Button variant="primary" danger type="submit" busy={busy}>
          {t("passkey.remove")}
        </Button>
        <Button onClick={onCancel}>{t("form.cancel")}</Button>
      </div>
    </form>
  );
}

export function Passkeys() {
  const state = useApi<PasskeyState>("/api/security/factor");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const close = () => {
    setAdding(false);
    setRemoving(null);
    setCodes(null);
    state.reload();
  };
  const s = state.data;
  const needCode = !!s && (s.enabled || s.passkeys.length > 0);
  const idle = !adding && !codes && !removing;
  return (
    <div className="card half">
      <div className="card-head">
        <div>
          <h2>{t("passkey.title")}</h2>
        </div>
        {s && idle && s.usable && passkeysSupported() && (
          <div className="form-row flush">
            <Button onClick={() => setAdding(true)}>{t("passkey.add")}</Button>
          </div>
        )}
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {/* nothing to press here: a status line, as "Ei käytössä." of the section above, and no box */}
      {s && !s.usable && <Empty>{t("passkey.https_note")}</Empty>}
      {s && s.usable && !passkeysSupported() && <Notice tone="info">{t("passkey.unsupported")}</Notice>}
      {codes && <RecoveryCodes codes={codes} onDone={close} />}
      {s && s.usable && !codes && s.passkeys.length === 0 && !adding && <Empty>{t("passkey.empty")}</Empty>}
      {s && !codes && (
        <ul className="passkey-list">
          {s.passkeys.map((p) => (
            <li key={p.id}>
              <strong>{p.label}</strong>{" "}
              <span className="small">
                {t("passkey.added", { date: dateTime(p.createdAt) })}, {p.lastUsedAt ? t("passkey.used", { date: dateTime(p.lastUsedAt) }) : t("passkey.unused")}
              </span>{" "}
              {idle && (
                <Button onClick={() => setRemoving(p.id)} aria-label={t("passkey.remove_named", { name: p.label })}>
                  {t("passkey.remove")}
                </Button>
              )}
              {removing === p.id && <Remove id={p.id} label={p.label} needCode={needCode} onDone={close} onCancel={close} />}
            </li>
          ))}
        </ul>
      )}
      {adding && !codes && <Add needCode={needCode} onDone={(c) => (c.length ? setCodes(c) : close())} onCancel={close} />}
    </div>
  );
}
