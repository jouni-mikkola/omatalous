/** Sign-in, first-run setup and password change screens. */
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { type ApiError, api } from "../api.ts";
import type { User } from "../types.ts";
import "../styles/auth.css";
import { Button } from "../components/ui/Button.tsx";
import { DeviceLanguage } from "../components/ui/DeviceLanguage.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { PasswordHint } from "../components/ui/PasswordHint.tsx";
import { checkPassword } from "@banking/core";
import { language } from "../format.ts";
import { t } from "../text.ts";
import { getPasskey, type RequestOptions } from "../webauthn.ts";
/** `device`: the screen is shown before a sign-in, so the device's language can be chosen on it. */
function AuthCard({ title, intro, device = true, children }: { title: string; intro?: ReactNode; device?: boolean; children: ReactNode }) {
  return (
    <main className="auth-wrap">
      <div className="card auth-card">
        <div className="brand card-head">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Omatalous
        </div>
        <h1 className="auth-title">{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        {children}
        {device && <DeviceLanguage />}
      </div>
    </main>
  );
}

function useSubmit<T>(fn: () => Promise<T>, onDone: (r: T) => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: Pick<FormEvent, "preventDefault">) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, submit };
}

export function Login({ onDone }: { onDone: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // after a right password of a member with a second factor the server waits for the code
  const [step, setStep] = useState<"password" | "code">("password");
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [expired, setExpired] = useState<string | null>(null);
  // what the second step offers: a passkey (the address allows it and the member has one) and a code
  const [offer, setOffer] = useState({ passkey: false, codes: true });
  const [passkeyNote, setPasskeyNote] = useState<string | null>(null);
  const first = useSubmit(
    () => api<{ user?: User; needsFactor?: boolean; passkey?: boolean; codes?: boolean }>("/api/auth/login", { method: "POST", body: { username, password } }),
    (r) => {
      setExpired(null);
      if (r.needsFactor) {
        setOffer({ passkey: !!r.passkey, codes: r.codes !== false });
        setPasskeyNote(null);
        setStep("code");
      }
      else onDone(r.user!);
    },
  );
  const second = useSubmit(
    async () => {
      try {
        return await api<{ user: User }>("/api/auth/factor", { method: "POST", body: { code } });
      } catch (err) {
        // the five minutes passed, or the password changed meanwhile: the password goes first again
        if ((err as ApiError).code === "half_expired") {
          setExpired((err as Error).message);
          setStep("password");
          setPassword("");
          setCode("");
          setRecovery(false);
        }
        throw err;
      }
    },
    (r) => onDone(r.user),
  );
  // the device's prompt: options from the server, the device's answer back; a dismissed prompt is a sentence, not an error
  const withPasskey = useSubmit(
    async () => {
      try {
        const answer = await getPasskey(await api<RequestOptions>("/api/auth/passkey/options", { method: "POST", body: {} }));
        if (!answer) return null;
        return await api<{ user: User }>("/api/auth/passkey", { method: "POST", body: { response: answer } });
      } catch (err) {
        if ((err as ApiError).code === "half_expired") {
          setExpired((err as Error).message);
          setStep("password");
          setPassword("");
          setCode("");
          setRecovery(false);
        }
        throw err;
      }
    },
    (r) => (r ? onDone(r.user) : setPasskeyNote(t("login.passkey_cancelled"))),
  );
  if (step === "code") {
    const cancel = () => {
      void api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
      setStep("password");
      setPassword("");
      setCode("");
      setRecovery(false);
    };
    return (
      <AuthCard title={t("login.title")} intro={t(offer.passkey ? "login.passkey_intro" : "login.code_intro")}>
        {offer.passkey && (
          <div className="auth-form">
            <Button variant="primary" busy={withPasskey.busy} onClick={withPasskey.submit}>
              {withPasskey.busy ? t("login.passkey_waiting") : t("login.passkey")}
            </Button>
            {withPasskey.error && <Notice tone="error">{withPasskey.error}</Notice>}
            {passkeyNote && !withPasskey.error && <Notice tone="info">{passkeyNote}</Notice>}
            {!offer.codes && <Button onClick={cancel}>{t("form.cancel")}</Button>}
          </div>
        )}
        {offer.codes && (
          <form className="auth-form" onSubmit={second.submit}>
            <label>
              {recovery ? t("login.recovery_code") : t("login.app_code")}
              {recovery ? (
                <input key="recovery" type="text" name="code" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={second.error ? true : undefined} required autoFocus={!offer.passkey} />
              ) : (
                <input key="totp" type="text" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={second.error ? true : undefined} required autoFocus={!offer.passkey} />
              )}
            </label>
            {second.error && <Notice tone="error">{second.error}</Notice>}
            <Button variant={offer.passkey ? "secondary" : "primary"} type="submit" busy={second.busy}>
              {second.busy ? t("login.busy") : t("login.title")}
            </Button>
            <div className="form-row">
              <Button onClick={() => { setRecovery(!recovery); setCode(""); }}>
                {recovery ? t("login.use_app_code") : t("login.use_recovery_code")}
              </Button>
              <Button onClick={cancel}>
                {t("form.cancel")}
              </Button>
            </div>
          </form>
        )}
      </AuthCard>
    );
  }
  const error = first.error ?? expired;
  return (
    <AuthCard title={t("login.title")}>
      <form className="auth-form" onSubmit={first.submit}>
        <label>
          {t("login.username")}
          <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={error ? true : undefined} required autoFocus />
        </label>
        <label>
          {t("login.password")}
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} required />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <Button variant="primary" type="submit" busy={first.busy}>
          {first.busy ? t("login.busy") : t("login.title")}
        </Button>
      </form>
    </AuthCard>
  );
}

type SetupField = "code" | "username" | "displayName" | "password" | "confirm";

/** The server sends one message; this puts it next to the field it is about. */
function fieldOfServerError(err: Error): SetupField | null {
  const code = (err as ApiError).messageCode ?? "";
  if (code.startsWith("auth.setup_code")) return "code";
  if (code.startsWith("auth.username")) return "username";
  if (code.startsWith("pw.")) return "password";
  return null;
}

/** The installer prints a link with the code in the fragment (#koodi=...), which never reaches the server or its logs. */
function codeFromLink(): string {
  const code = new URLSearchParams(window.location.hash.replace(/^#\/?\??/, "")).get("koodi") ?? "";
  return /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/.test(code) ? code : "";
}

export function Setup({ onDone }: { onDone: (user: User) => void }) {
  const [form, setForm] = useState(() => ({ code: codeFromLink(), username: "", displayName: "", password: "", confirm: "" }));
  const [errors, setErrors] = useState<Partial<Record<SetupField | "form", string>>>({});
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const set = (k: SetupField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: undefined });
  };
  const fail = (next: typeof errors) => {
    setErrors(next);
    const first = (["code", "username", "displayName", "password", "confirm"] as const).find((k) => next[k]);
    if (first) formRef.current?.querySelector<HTMLInputElement>(`[name=${first}]`)?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found: typeof errors = {};
    if (!form.code.trim()) found.code = t("setup.need_code");
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(form.username)) found.username = t("auth.username_shape");
    if (!form.displayName.trim()) found.displayName = t("setup.need_name");
    const problem = checkPassword(form.password, language()).problem;
    if (problem) found.password = problem;
    else if (form.password !== form.confirm) found.confirm = t("setup.mismatch");
    if (Object.keys(found).length) return fail(found);
    setBusy(true);
    setErrors({});
    try {
      const r = await api<{ user: User }>("/api/auth/setup", { method: "POST", body: form });
      onDone(r.user);
    } catch (err) {
      const message = (err as Error).message;
      const field = fieldOfServerError(err as Error);
      fail(field ? { [field]: message } : { form: message });
    } finally {
      setBusy(false);
    }
  };

  const field = (k: SetupField, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label>
      {label}
      <input name={k} value={form[k]} onChange={set(k)} aria-invalid={errors[k] ? true : undefined} aria-describedby={errors[k] ? `err-${k}` : undefined} {...props} />
      {errors[k] && (
        <span className="field-error" id={`err-${k}`}>
          {errors[k]}
        </span>
      )}
    </label>
  );
  return (
    <AuthCard title={t("setup.title")} intro={t("setup.intro")}>
      <form className="auth-form" onSubmit={submit} noValidate ref={formRef}>
        {field("code", t("setup.code"), { type: "text", autoFocus: !form.code, autoComplete: "off", spellCheck: false })}
        {field("username", t("login.username"), { type: "text", autoComplete: "username", autoFocus: !!form.code })}
        {field("displayName", t("setup.name"), { type: "text", autoComplete: "name" })}
        {field("password", t("setup.password"), { type: "password", autoComplete: "new-password" })}
        <PasswordHint password={form.password} />
        {field("confirm", t("setup.confirm"), { type: "password", autoComplete: "new-password" })}
        {errors.form && <Notice tone="error">{errors.form}</Notice>}
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? t("setup.busy") : t("setup.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}

/**
 * The fields of a password change: the current one and the new one twice. The forced change after a temporary password
 * asks only the new one twice and shows it on a page of its own;
 * a member who wants a new one finds it in Asetukset > Salasana.
 */
export function PasswordForm({ forced, onDone, onCancel }: { forced?: boolean; onDone: () => void; onCancel?: () => void }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const { error, busy, submit } = useSubmit(async () => {
    const problem = checkPassword(form.next, language()).problem;
    if (problem) throw new Error(problem);
    if (form.next !== form.confirm) throw new Error(t("setup.mismatch"));
    // the sign-in just proved the temporary password, so the forced change asks only the new one
    if (forced) return api("/api/auth/first-password", { method: "POST", body: { next: form.next } });
    return api("/api/auth/password", { method: "POST", body: { current: form.current, next: form.next } });
  }, onDone);
  return (
    <form className="auth-form" onSubmit={submit}>
      {!forced && (
        <label>
          {t("pwchange.current")}
          <input type="password" autoComplete="current-password" value={form.current} onChange={set("current")} required />
        </label>
      )}
      <label>
        {t("pwchange.new")}
        <input type="password" autoComplete="new-password" value={form.next} onChange={set("next")} required minLength={12} autoFocus={forced} />
      </label>
      <PasswordHint password={form.next} />
      <label>
        {t("pwchange.new_again")}
        <input type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} required minLength={12} />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="form-row">
        <Button variant="primary" type="submit" busy={busy}>
          {t("pwchange.title")}
        </Button>
        {onCancel && (
          <Button onClick={onCancel}>
            {t("form.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}

/** The page of the forced change: a member signs in with a temporary password and must pick their own. */
export function ChangePassword({ onDone }: { onDone: () => void }) {
  return (
    <AuthCard device={false} title={t("pwchange.title")} intro={t("pwchange.intro")}>
      <PasswordForm forced onDone={onDone} />
    </AuthCard>
  );
}
