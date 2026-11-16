/**
 * The Lisäosa card (admin only, docs/MODULES.md): on Asetukset > Lisäosa while a module is loaded, on Palvelin ja
 * ylläpito before (AddOnPage.tsx, ServerPage.tsx).
 * Decision: whether the household connects an add-on module, and whether it keeps it. One field takes the code; the
 * server seals it and never sends it back, so the card shows only where the add-on stands, once, in its head. While the
 * server holds a code the field and Tallenna koodi are not drawn: the card then only removes the add-on.
 */
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { FoldCard } from "../../components/ui/FoldCard.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { useApi } from "../../hooks.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import "../../styles/settings.css";
import { t } from "../../text.ts";
import { addOnLine, type AddOnView } from "./addon-line.ts";

type Busy = "save" | "remove" | null;

/** The fields and buttons. A module that runs with no code stored (noCode) still takes one; a connected or downloaded one has its code. */
export function AddOnForm({ view, busy, error, onSend }: { view: AddOnView; busy: Busy; error: string | null; onSend: (what: "save" | "remove", code: string, password: string) => Promise<boolean> }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const holdsCode = view.state === "pending" || (view.state === "connected" && !view.noCode);
  const send = async (what: "save" | "remove") => {
    if (await onSend(what, code.trim(), password)) {
      setCode("");
      setPassword("");
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!holdsCode) void send("save");
  };
  return (
    <form className="setup-form" onSubmit={submit} noValidate>
      {!holdsCode && (
        <label>
          <span className="field-label">{t("set.addon.code")}</span>
          <input name="addon-code" type="password" autoComplete="off" spellCheck={false} maxLength={1024} value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
      )}
      <label>
        <span className="field-label">{t("set.addon.password")}</span>
        <input name="addon-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="form-row">
        {!holdsCode && (
          <Button variant="primary" type="submit" busy={busy === "save"} disabled={!code.trim() || !password || busy !== null}>
            {busy === "save" ? t("set.addon.saving") : t("set.addon.save")}
          </Button>
        )}
        {view.state !== "none" && (
          <Button onClick={() => void send("remove")} busy={busy === "remove"} disabled={busy !== null}>
            {busy === "remove" ? t("set.addon.removing") : t("set.addon.remove")}
          </Button>
        )}
      </div>
    </form>
  );
}

export function AddOn() {
  const loaded = useApi<AddOnView>("/api/modules");
  const [state, setState] = useState<AddOnView | null>(null);
  const view = state ?? loaded.data;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  /** Whether the call went through, so that the fields are emptied only then. */
  const send = async (what: "save" | "remove", code: string, password: string): Promise<boolean> => {
    if (busy) return false;
    if (what === "remove" && !password) {
      setError(t("set.addon.remove_needs_password"));
      return false;
    }
    setBusy(what);
    setError(null);
    try {
      setState(
        what === "save"
          ? await api<AddOnView>("/api/modules/code", { method: "PUT", body: { code, password } })
          : await api<AddOnView>("/api/modules/code", { method: "DELETE", body: { password } }),
      );
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <FoldCard id={SETTINGS_ANCHOR.addOn} title={t("set.addon.title")} sub={view ? addOnLine(view) : undefined} folded={!view || view.state === "none"}>
      {loaded.error && <Notice tone="warning">{loaded.error}</Notice>}
      {view && <AddOnForm view={view} busy={busy} error={error} onSend={send} />}
    </FoldCard>
  );
}
