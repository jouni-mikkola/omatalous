/**
 * Asetukset > Palvelin > Lisäosa (admin only, docs/MODULES.md).
 * Decision: whether the household connects an add-on module, and whether it keeps it. One field takes the code; the
 * server seals it and never sends it back, so the card shows only where the add-on stands.
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

export function AddOn() {
  const loaded = useApi<AddOnView>("/api/modules");
  const [state, setState] = useState<AddOnView | null>(null);
  const view = state ?? loaded.data;
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);

  const send = async (what: "save" | "remove") => {
    if (busy) return;
    if (what === "remove" && !password) {
      setError(t("set.addon.remove_needs_password"));
      return;
    }
    setBusy(what);
    setError(null);
    try {
      const next =
        what === "save"
          ? await api<AddOnView>("/api/modules/code", { method: "PUT", body: { code: code.trim(), password } })
          : await api<AddOnView>("/api/modules/code", { method: "DELETE", body: { password } });
      setState(next);
      setCode("");
      setPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send("save");
  };

  return (
    <FoldCard id={SETTINGS_ANCHOR.addOn} title={t("set.addon.title")} sub={view ? addOnLine(view) : undefined} folded={!view || view.state === "none"}>
      <p>{t("set.addon.intro")}</p>
      {loaded.error && <Notice tone="warning">{loaded.error}</Notice>}
      {view && (
        <form className="setup-form" onSubmit={submit} noValidate>
          <p role="status">{addOnLine(view)}</p>
          <label>
            <span className="field-label">{t("set.addon.code")}</span>
            <input name="addon-code" type="password" autoComplete="off" spellCheck={false} maxLength={1024} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label>
            <span className="field-label">{t("set.addon.password")}</span>
            <input name="addon-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="form-row">
            <Button variant="primary" type="submit" busy={busy === "save"} disabled={!code.trim() || !password || busy !== null}>
              {busy === "save" ? t("set.addon.saving") : t("set.addon.save")}
            </Button>
            {view.state !== "none" && (
              <Button onClick={() => void send("remove")} busy={busy === "remove"} disabled={busy !== null}>
                {busy === "remove" ? t("set.addon.removing") : t("set.addon.remove")}
              </Button>
            )}
          </div>
        </form>
      )}
    </FoldCard>
  );
}
