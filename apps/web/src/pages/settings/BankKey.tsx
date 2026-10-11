/**
 * Optional: a member's own Enable Banking application (app id + private key,
 * stored encrypted on the server). Usually the household's shared app,
 * set up by the admin, is enough.
 */
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import type { Meta } from "../../types.ts";

export function BankKey({ meta, onChange }: { meta: Meta; onChange: () => void }) {
  const [appId, setAppId] = useState("");
  const [pem, setPem] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    // a key is a few kilobytes; the server refuses anything over 16 KB anyway
    if (file.size > 16 * 1024) return setMessage({ ok: false, text: "Tiedosto ei ole avain." });
    setPem(await file.text());
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/bank/credentials", { method: "PUT", body: { appId, privateKeyPem: pem } });
      setPem(""); // do not keep the key in the page longer than needed
      setMessage({ ok: true, text: "Avain tallennettu." });
      onChange();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
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
      <p className="small muted">
        Vain jos et käytä yhteistä sovellusta. Paluuosoite: <code>{meta.bank.redirectUrl}</code>
      </p>
      {!meta.bank.canStoreOwnKeys ? (
        <p className="notice warning">Avaimia ei voi nyt tallentaa. Pyydä ylläpitäjää katsomaan palvelimen lokia.</p>
      ) : (
        <form className="stack" onSubmit={save} style={{ gap: 8 }}>
          <input type="text" placeholder="Application ID (UUID)" value={appId} onChange={(e) => setAppId(e.target.value)} required aria-label="Application ID" />
          <input type="file" accept=".pem,.key,text/plain" onChange={(e) => void readFile(e.target.files?.[0])} aria-label="Yksityinen avain tiedostona" />
          <textarea placeholder="Liitä avain tai valitse tiedosto" value={pem} onChange={(e) => setPem(e.target.value)} required aria-label="Yksityinen avain" spellCheck={false} />
          <div className="form-row">
            <button className="btn btn-primary" type="submit">
              Tallenna
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
