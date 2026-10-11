/**
 * Optional: a member's own Enable Banking application (app id + private key,
 * stored encrypted on the server). Usually the household's shared app,
 * set up by the admin, is enough. The page lists the addresses Enable Banking's
 * registration form asks for, and saving tries the pair against Enable Banking.
 */
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import type { Meta } from "../../types.ts";
import { CopyValue } from "./BankAppSetup.tsx";

export function BankKey({ meta, onChange }: { meta: Meta; onChange: () => void }) {
  const [appId, setAppId] = useState("");
  const [pem, setPem] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    // a key is a few kilobytes; the server refuses anything over 16 KB anyway
    if (file.size > 16 * 1024) return setMessage({ ok: false, text: "Tiedosto ei ole avain." });
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
    <details className="card">
      <summary>
        <strong>Oma Enable Banking -sovellus</strong>{" "}
        <span className="muted small">
          {meta.bank.source === "user" ? "· käytössä oma avain" : meta.bank.source === "instance" ? "· käytössä talouden yhteinen sovellus" : "· ei määritetty"}
        </span>
      </summary>
      <p className="small muted">Vain jos et käytä yhteistä sovellusta. Enable Bankingin rekisteröintilomake kysyy nämä osoitteet:</p>
      <ul className="small">
        <li>
          <span className="eb-label">Allowed redirect URLs</span>: <CopyValue value={meta.bank.redirectUrl} label="Allowed redirect URLs" />
        </li>
        <li>
          <span className="eb-label">Privacy URL</span>: <CopyValue value={meta.bank.privacyUrl} label="Privacy URL" />
        </li>
        <li>
          <span className="eb-label">Terms URL</span>: <CopyValue value={meta.bank.termsUrl} label="Terms URL" />
        </li>
      </ul>
      {!meta.bank.canStoreOwnKeys ? (
        <p className="notice warning">Avaimia ei voi nyt tallentaa. Pyydä ylläpitäjää katsomaan palvelimen lokia.</p>
      ) : (
        <form className="stack" onSubmit={save} style={{ gap: 8 }}>
          <input type="text" placeholder="Application ID (UUID)" value={appId} onChange={(e) => setAppId(e.target.value)} required aria-label="Application ID" />
          <input type="file" accept=".pem,.key,text/plain" onChange={(e) => void readFile(e.target.files?.[0])} aria-label="Yksityinen avain tiedostona" />
          <textarea placeholder="Liitä avain tai valitse tiedosto" value={pem} onChange={(e) => setPem(e.target.value)} required aria-label="Yksityinen avain" spellCheck={false} />
          <div className="form-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Testataan…" : "Tallenna ja testaa"}
            </button>
            {meta.bank.source === "user" && (
              <button
                className="btn btn-danger"
                type="button"
                onClick={async () => {
                  try {
                    await api("/api/bank/credentials", { method: "DELETE" });
                    setMessage({ ok: true, text: "Oma avain poistettu." });
                    onChange();
                  } catch (err) {
                    setMessage({ ok: false, text: (err as Error).message });
                  }
                }}
              >
                Poista oma avain
              </button>
            )}
          </div>
        </form>
      )}
      {message && <div className={message.ok ? "notice good" : "notice warning"}>{message.text}</div>}
    </details>
  );
}
