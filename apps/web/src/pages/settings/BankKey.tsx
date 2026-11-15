/**
 * The body of the own-application choice of the bank app card: a user's own Enable Banking application (app id +
 * private key, stored encrypted on the server). Usually the household's shared app, set up by the admin, is enough.
 * It lists the addresses Enable Banking's registration form asks for, and saving tries the pair against Enable Banking.
 */
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import type { Meta } from "../../types.ts";
import { CopyAll, Copyable } from "./CopyValue.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";
export function BankKey({ meta, onChange }: { meta: Meta; onChange: () => void }) {
  const [appId, setAppId] = useState("");
  const [pem, setPem] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    // a key is a few kilobytes; the server refuses anything over 16 KB anyway
    if (file.size > 16 * 1024) return setMessage({ ok: false, text: t("set.key.the_file_is_not_a") });
    setPem(await file.text());
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      // the server tries the pair against Enable Banking: a wrong one is refused and not saved
      const { result } = await api<{ result: { verified: boolean; message: string } }>("/api/bank/credentials", { method: "PUT", body: { appId, privateKeyPem: pem } });
      setPem(""); // do not keep the key in the page longer than needed
      setMessage({ ok: result.verified, text: result.message });
      onChange();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="small muted">{t("set.key.only_if_you_do_not")}</p>
      <ul className="small">
        <li>
          <span className="eb-label">Allowed redirect URLs</span>: <Copyable value={meta.bank.redirectUrl} />
        </li>
        <li>
          <span className="eb-label">Privacy URL</span>: <Copyable value={meta.bank.privacyUrl} />
        </li>
        <li>
          <span className="eb-label">Terms URL</span>: <Copyable value={meta.bank.termsUrl} />
        </li>
      </ul>
      <div className="form-row">
        <CopyAll
          fields={[
            { label: "Allowed redirect URLs", value: meta.bank.redirectUrl },
            { label: "Privacy URL", value: meta.bank.privacyUrl },
            { label: "Terms URL", value: meta.bank.termsUrl },
          ]}
        />
      </div>
      {!meta.bank.canStoreOwnKeys ? (
        <Notice tone="warning" as="p">{t("set.key.the_keys_cannot_be_saved")}</Notice>
      ) : (
        <form className="stack stack-8" onSubmit={save}>
          <input type="text" placeholder={t("set.app.application_id_12345678_abcd")} value={appId} onChange={(e) => setAppId(e.target.value)} required aria-label={t("set.app.id_label")} />
          <input type="file" accept=".pem,.key,text/plain" onChange={(e) => void readFile(e.target.files?.[0])} required aria-label={t("set.key.private_key_as_a_file")} />
          <div className="form-row">
            <Button variant="primary" type="submit" busy={busy}>
              {busy ? t("set.key.testing") : t("set.key.save_and_test")}
            </Button>
            {meta.bank.source === "user" && (
              <Button
                
                onClick={async () => {
                  try {
                    await api("/api/bank/credentials", { method: "DELETE" });
                    setMessage({ ok: true, text: t("set.key.own_key_removed") });
                    onChange();
                  } catch (err) {
                    setMessage({ ok: false, text: (err as Error).message });
                  }
                }}
              >
                {t("set.key.remove_own_key")}
              </Button>
            )}
          </div>
        </form>
      )}
      {message && <Notice tone={message.ok ? "good" : "warning"}>{message.text}</Notice>}
    </>
  );
}
