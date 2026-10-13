/** Sign-in, first-run setup and password change screens. */
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { api } from "../api.ts";
import type { User } from "../types.ts";
import "../styles/auth.css";

function AuthCard({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="brand card-head">
          <span className="brand-mark" aria-hidden="true">
            <i style={{ height: 6 }} />
            <i style={{ height: 10 }} />
            <i style={{ height: 13 }} />
          </span>
          Omatalous
        </div>
        <h1 className="auth-title">{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        {children}
      </div>
    </div>
  );
}

function useSubmit<T>(fn: () => Promise<T>, onDone: (r: T) => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
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
  const { error, busy, submit } = useSubmit(() => api<{ user: User }>("/api/auth/login", { method: "POST", body: { username, password } }), (r) => onDone(r.user));
  return (
    <AuthCard title="Kirjaudu sisään">
      <form className="auth-form" onSubmit={submit}>
        <label>
          Käyttäjätunnus
          <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={error ? true : undefined} required autoFocus />
        </label>
        <label>
          Salasana
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Kirjaudutaan…" : "Kirjaudu"}
        </button>
      </form>
    </AuthCard>
  );
}

type SetupField = "code" | "username" | "displayName" | "password" | "confirm";

/** The server sends one message; this puts it next to the field it is about. */
function fieldOfServerError(message: string): SetupField | null {
  if (/asennuskoodi/i.test(message)) return "code";
  if (/^Käyttäjätunnus/.test(message)) return "username";
  if (/salasana/i.test(message)) return "password";
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
    if (!form.code.trim()) found.code = "Anna asennuskoodi.";
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(form.username)) found.username = "Käyttäjätunnuksessa pitää olla 3–32 merkkiä (a–z, 0–9, . _ -).";
    if (!form.displayName.trim()) found.displayName = "Anna nimi.";
    if (form.password.length < 12) found.password = "Vähintään 12 merkkiä.";
    else if (form.password !== form.confirm) found.confirm = "Salasanat eivät täsmää.";
    if (Object.keys(found).length) return fail(found);
    setBusy(true);
    setErrors({});
    try {
      const r = await api<{ user: User }>("/api/auth/setup", { method: "POST", body: form });
      onDone(r.user);
    } catch (err) {
      const message = (err as Error).message;
      const field = fieldOfServerError(message);
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
        <span className="error field-error" id={`err-${k}`}>
          {errors[k]}
        </span>
      )}
    </label>
  );
  return (
    <AuthCard title="Ota sovellus käyttöön" intro="Luo ylläpitäjän tunnus. Asennuskoodi näkyy asennuksen lopussa.">
      <form className="auth-form" onSubmit={submit} noValidate ref={formRef}>
        {field("code", "Asennuskoodi", { type: "text", autoFocus: !form.code, autoComplete: "off", spellCheck: false })}
        {field("username", "Käyttäjätunnus", { type: "text", autoComplete: "username", autoFocus: !!form.code })}
        {field("displayName", "Nimi", { type: "text", autoComplete: "name" })}
        {field("password", "Salasana (vähintään 12 merkkiä)", { type: "password", autoComplete: "new-password" })}
        {field("confirm", "Salasana uudelleen", { type: "password", autoComplete: "new-password" })}
        {errors.form && <div className="error">{errors.form}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Luodaan…" : "Luo ja kirjaudu"}
        </button>
      </form>
    </AuthCard>
  );
}

/**
 * The three fields of a password change. The forced change after a temporary password shows it on a page of its own;
 * a member who wants a new one finds it in Asetukset > Salasana.
 */
export function PasswordForm({ forced, onDone, onCancel }: { forced?: boolean; onDone: () => void; onCancel?: () => void }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const { error, busy, submit } = useSubmit(async () => {
    if (form.next !== form.confirm) throw new Error("Salasanat eivät täsmää.");
    return api("/api/auth/password", { method: "POST", body: { current: form.current, next: form.next } });
  }, onDone);
  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        {forced ? "Väliaikainen salasana" : "Nykyinen salasana"}
        <input type="password" autoComplete="current-password" value={form.current} onChange={set("current")} required autoFocus={forced} />
      </label>
      <label>
        Uusi salasana (vähintään 12 merkkiä)
        <input type="password" autoComplete="new-password" value={form.next} onChange={set("next")} required minLength={12} />
      </label>
      <label>
        Uusi salasana uudelleen
        <input type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} required minLength={12} />
      </label>
      {error && <div className="error">{error}</div>}
      <div className="form-row">
        <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
          Vaihda salasana
        </button>
        {onCancel && (
          <button className="btn" type="button" onClick={onCancel}>
            Peruuta
          </button>
        )}
      </div>
    </form>
  );
}

/** The page of the forced change: a member signs in with a temporary password and must pick their own. */
export function ChangePassword({ onDone }: { onDone: () => void }) {
  return (
    <AuthCard title="Vaihda salasana" intro="Vaihda väliaikainen salasana omaksi.">
      <PasswordForm forced onDone={onDone} />
    </AuthCard>
  );
}
