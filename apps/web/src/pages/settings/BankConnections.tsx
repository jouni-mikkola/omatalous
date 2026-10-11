/**
 * The member's bank consents: "Lisää pankkiyhteys" opens a bank picker
 * (the banks the server offers, each with its official logo), the list
 * shows each consent's validity, and a fallback finishes a consent whose
 * redirect page did not open.
 */
import { useState } from "react";
import { api } from "../../api.ts";
import { bankLogo, logoForInstitution } from "../../banks.ts";
import { BankLogo } from "../../components/BankLogo.tsx";
import { date, dateTime, plural } from "../../format.ts";
import type { Meta } from "../../types.ts";

const COUNTRY: Record<string, string> = { FI: "Suomi" };

/**
 * The notice after a finished consent, from the callback or the pasted
 * address. Zero accounts is a warning: no transactions will ever come
 * until the accounts are linked in Enable Banking.
 */
export function connectedMessage(accounts: number): { tone: "good" | "warning"; text: string } {
  return accounts > 0
    ? { tone: "good", text: `Pankki yhdistetty, ${plural(accounts, "tili", "tiliä")}. Tapahtumat haetaan hetken päästä.` }
    : { tone: "warning", text: "Pankki ei antanut yhtään tiliä. Linkitä tilit Enable Bankingissa (Link accounts) ja yritä uudelleen." };
}

export function BankConnections({
  meta,
  pickerOpen,
  onChange,
  onMessage,
}: {
  meta: Meta;
  pickerOpen: boolean;
  onChange: () => void;
  onMessage: (m: { tone: "good" | "warning"; text: string }) => void;
}) {
  const [picking, setPicking] = useState(pickerOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const mode = meta.bank.redirectMode;
  const hasActive = meta.connections.some((c) => c.status === "active");
  const isAdmin = meta.user.role === "admin";

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const text = await fn();
      if (text) onMessage({ tone: "good", text });
      onChange();
    } catch (err) {
      onMessage({ tone: "warning", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const connect = (bank: string) => {
    // paste mode: the bank's last page is an error page whose address the user copies here, so the bank opens
    // in a new tab (from this click, or the popup blocker stops it) and this page stays with the paste box open
    const tab = mode === "paste" ? window.open("", "_blank") : null;
    return run(`connect-${bank}`, async () => {
      try {
        const { url } = await api<{ url: string }>("/api/connections/start", { method: "POST", body: { bank, returnTo: window.location.origin } });
        if (tab) {
          tab.opener = null;
          tab.location.href = url;
          setPasteOpen(true);
        } else window.location.href = url;
      } catch (err) {
        tab?.close();
        throw err;
      }
    });
  };

  return (
    <div className="card" id="pankkiyhteydet">
      <div className="card-head">
        <div>
          <h2>Pankkiyhteydet</h2>
          <div className="card-sub">Yhteys on voimassa 180 päivää kerrallaan.</div>
        </div>
        {!picking && (
          <button className="btn btn-primary" type="button" onClick={() => setPicking(true)}>
            {hasActive ? "Lisää seuraava tili" : "Lisää pankkiyhteys"}
          </button>
        )}
      </div>
      {mode === "relay" && <p className="small muted">Yhdistä laitteella, joka on kotiverkossa.</p>}

      {picking && (
        <section className="bank-picker" aria-labelledby="bank-picker-title">
          <div className="bank-picker-head">
            <h3 id="bank-picker-title">Valitse pankki</h3>
            <button className="btn btn-small" type="button" onClick={() => setPicking(false)}>
              Sulje
            </button>
          </div>
          <div className="bank-grid">
            {meta.bank.banks.map((b) => (
              <button
                key={b.id}
                type="button"
                className="bank-tile"
                disabled={!meta.bank.configured || busy !== null}
                onClick={() => void connect(b.id)}
                aria-label={`Yhdistä ${b.name}`}
              >
                <BankLogo src={bankLogo(b.id)} name={b.name} />
                <span className="bank-tile-text">
                  <strong>{b.name}</strong>
                  <span className="small muted">Henkilöasiakkaat · {COUNTRY[b.country] ?? b.country}</span>
                </span>
                <span className="bank-tile-go" aria-hidden="true">
                  {busy === `connect-${b.id}` ? "…" : "›"}
                </span>
              </button>
            ))}
          </div>
          {meta.bank.configured ? (
            <p className="small muted">Kirjaudut Nordean sivulla. Sovellus näkee vain tapahtumat ja saldot. Lisää jokainen tili ja luottokortti erikseen.</p>
          ) : isAdmin ? (
            <div className="notice warning">
              Määritä ensin Enable Banking kohdassa <a href="#/settings?section=server">Palvelin</a>.
            </div>
          ) : (
            <div className="notice warning">Ylläpitäjän pitää ensin ottaa pankkiyhteydet käyttöön.</div>
          )}
        </section>
      )}

      {meta.connections.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pankki</th>
                <th>Tila</th>
                <th>Voimassa</th>
                <th>Haettu</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {meta.connections.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="bank-cell">
                      <BankLogo src={logoForInstitution(c.institution)} name={c.institution} size="sm" />
                      {c.institution}
                    </span>
                  </td>
                  <td>
                    {c.status === "active" ? "käytössä" : c.status === "expired" ? "vanhentunut" : "poistettu"}
                    {c.status === "active" && c.daysLeft !== null && c.daysLeft <= 14 && <span className="badge warn">vanhenee pian</span>}
                  </td>
                  <td>
                    {date(c.validUntil)}
                    {c.daysLeft !== null && c.daysLeft > 0 && c.status === "active" && <span className="muted small"> ({c.daysLeft} pv)</span>}
                  </td>
                  <td>{dateTime(c.lastSyncedAt)}</td>
                  <td className="num">
                    {c.status === "active" && (
                      <button
                        className="btn btn-small btn-danger"
                        disabled={busy !== null}
                        onClick={() =>
                          run(`del-${c.id}`, async () => {
                            await api(`/api/connections/${encodeURIComponent(c.id)}`, { method: "DELETE" });
                            return "Yhteys poistettu.";
                          })
                        }
                      >
                        Poista
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !picking && <p className="muted">Ei pankkiyhteyksiä.</p>
      )}

      {meta.bank.configured && (
        <details open={pasteOpen || undefined} onToggle={(e) => setPasteOpen(e.currentTarget.open)}>
          <summary className="small muted">{mode === "paste" ? "Kun pankki on näyttänyt virhesivun" : "Jos paluusivu ei aukea"}</summary>
          {mode === "paste" && <p className="small muted">Kun Nordea näyttää virhesivun, kopioi sen osoite tähän.</p>}
          <form
            className="form-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run("paste", async () => {
                const r = await api<{ accounts: number }>("/api/connections/complete", { method: "POST", body: { url: pasted } });
                setPasted("");
                setPasteOpen(false);
                onMessage(connectedMessage(r.accounts));
              });
            }}
          >
            <input
              type="text"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="Liitä osoite selaimen osoiteriviltä"
              aria-label="Pankin palauttama osoite"
              spellCheck={false}
              autoComplete="off"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              required
            />
            <button className="btn" type="submit" disabled={busy !== null}>
              Viimeistele
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
