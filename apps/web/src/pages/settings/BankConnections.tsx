/**
 * The member's bank consents: "Lisää pankkiyhteys" opens a bank picker
 * (the banks the server offers, each with its official logo), the list
 * shows each consent's validity and the accounts it reads (name and IBAN, so two consents of one holder differ),
 * and a fallback finishes a consent whose redirect page did not open.
 */
import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import { bankIdForInstitution, bankLogo, logoForInstitution } from "../../banks.ts";
import { BankLogo } from "../../components/BankLogo.tsx";
import { WARN_DAYS } from "../../consent-notices.ts";
import { accountNumber, date, dateTime, plural } from "../../format.ts";
import type { Account, Connection, Meta } from "../../types.ts";

const COUNTRY: Record<string, string> = { FI: "Suomi" };

/**
 * The bank callback sends only these codes (routes/bank.ts). The link reasons have the same words as LINK_FAILURES in
 * the server's connectors/link-state.ts, which a pasted address gets; anything else reads as "failed".
 */
export const CONNECT_ERRORS: Record<string, string> = {
  session: "Kirjautuminen vanheni. Kirjaudu ja yhdistä pankki uudelleen.",
  setup: "Pankkiyhteydet eivät ole käytössä. Pyydä ylläpitäjää ottamaan ne käyttöön.",
  failed: "Yhdistäminen epäonnistui. Yritä uudelleen.",
  cancelled: "Yhdistäminen keskeytyi.",
  bank: "Pankki keskeytti yhdistämisen. Syy näkyy Enable Bankingin Control Panelissa sovelluksen pyyntölokissa.",
  inactive: "Enable Banking ei vielä päästä sovellusta pankkeihin. Ylläpitäjä painaa Control Panelissa Activate by linking accounts.",
  app: "Enable Banking ei tunnistanut sovellusta. Ylläpitäjä tarkistaa sen kohdassa Asetukset > Palvelin > Testaa yhteys.",
  refused: "Enable Banking hylkäsi yhdistämisen. Syy näkyy Control Panelissa sovelluksen pyyntölokissa.",
  expired: "Yhdistäminen vanheni. Yritä uudelleen.",
};

/** hasOwn: the code comes from the address bar, so "constructor" must not find an inherited value. */
export function connectError(code: string): string {
  return Object.hasOwn(CONNECT_ERRORS, code) ? CONNECT_ERRORS[code]! : CONNECT_ERRORS.failed!;
}

/** The Tila column: the same words as the notice and Tietojen laatu, and no date ahead for a consent that broke. */
export function connectionStateText(c: Pick<Connection, "state" | "validUntil">): string {
  if (c.state === "lapsed") return `vanhentui ${date(c.validUntil)}`;
  if (c.state === "broken") return "katkesi";
  if (c.state === "removed") return "poistettu";
  return "käytössä";
}

/**
 * The Haettu column: when the accounts of a consent were last fetched, or, while none was, why. A consent that ended
 * keeps the date of its last run.
 */
export function fetchedText(conn: Pick<Connection, "id" | "state" | "lastSyncedAt">, accounts: readonly Pick<Account, "connectionId" | "lastSyncedAt" | "problem">[]): string {
  const own = accounts.filter((a) => a.connectionId === conn.id);
  const last = own.reduce<string | null>((late, a) => (a.lastSyncedAt && (!late || a.lastSyncedAt > late) ? a.lastSyncedAt : late), null);
  if (last) return dateTime(last);
  if (conn.state !== "active" || !own.length) return dateTime(conn.lastSyncedAt);
  if (own.some((a) => a.problem?.kind === "not_linked")) return "Ei linkitetty Control Panelissa";
  if (own.some((a) => a.problem?.kind === "failed")) return "Haku epäonnistui";
  return "Odottaa ensimmäistä hakua";
}

/**
 * The notice after a finished consent, from the callback or the pasted
 * address. Zero accounts is a warning: no transactions will ever come
 * until the accounts are linked in Enable Banking.
 */
export function connectedMessage(accounts: number): { tone: "good" | "warning"; text: string } {
  return accounts > 0
    ? { tone: "good", text: `Pankki yhdistetty, ${plural(accounts, "tili", "tiliä")}. Tapahtumat tulevat hetken päästä.` }
    : { tone: "warning", text: "Pankki ei antanut tilejä. Linkitä tilit Enable Bankingissa (Link accounts) ja yritä uudelleen." };
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
  // the banner of an ended consent links here (#/settings?add=1) while the page may already be open
  useEffect(() => {
    if (pickerOpen) setPicking(true);
  }, [pickerOpen]);
  const [busy, setBusy] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const mode = meta.bank.redirectMode;
  // a consent that owns no account is history: its accounts moved to a newer one, or it never had any
  const current = meta.connections.filter((c) => !c.history);
  const history = meta.connections.filter((c) => c.history);
  const isAdmin = meta.user.role === "admin";
  // an app that reads Inactive is not held back here: starting a connection tests it again and says what is wrong
  const canStart = meta.bank.configured || !!meta.bank.inactive;
  const accountsOf = (connectionId: string) => meta.accounts.filter((a) => a.connectionId === connectionId);

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

  // a consent that ended or ends soon is renewed with the same bank: one click, no picker. A bank that is not on the
  // list, or no Enable Banking application yet, opens the picker, which says what is missing.
  const reconnect = (c: Connection) => {
    const bank = bankIdForInstitution(meta.bank.banks, c.institution);
    if (bank && canStart) void connect(bank);
    else setPicking(true);
  };
  const canReconnect = (c: Connection) =>
    c.state === "lapsed" || c.state === "broken" || (c.state === "active" && c.daysLeft !== null && c.daysLeft <= WARN_DAYS);

  return (
    <div className="card" id="pankkiyhteydet">
      <div className="card-head">
        <div>
          <h2>Pankkiyhteydet</h2>
        </div>
        {!picking && (
          <button className="btn btn-primary" type="button" onClick={() => setPicking(true)}>
            Lisää pankkiyhteys
          </button>
        )}
      </div>

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
                disabled={!canStart || busy !== null}
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
            <p className="small muted">Lisää jokainen tili ja luottokortti erikseen.</p>
          ) : meta.bank.inactive ? (
            <div className="notice warning">
              {CONNECT_ERRORS.inactive} Kun tilit on linkitetty, pankin valinta testaa yhteyden uudelleen.
            </div>
          ) : isAdmin ? (
            <div className="notice warning">
              Määritä ensin Enable Banking kohdassa <a href="#/settings?section=server">Palvelin</a>.
            </div>
          ) : (
            <div className="notice warning">Ylläpitäjän pitää ensin ottaa pankkiyhteydet käyttöön.</div>
          )}
        </section>
      )}

      {current.length > 0 ? (
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
              {current.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="bank-cell">
                      <BankLogo src={logoForInstitution(c.institution)} name={c.institution} size="sm" />
                      {c.institution}
                    </span>
                    {/* two consents of one bank are told apart by their accounts: the name and the IBAN or card number */}
                    <div className="conn-accounts">
                      {accountsOf(c.id).map((a) => (
                        <div key={a.id} className="sub muted small acc-line">
                          {[a.name, accountNumber(a)].filter(Boolean).join(" · ")}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>
                    {connectionStateText(c)}
                    {c.state === "active" && c.daysLeft !== null && c.daysLeft <= WARN_DAYS && <span className="badge warn">vanhenee pian</span>}
                  </td>
                  <td>
                    {c.state === "active" ? date(c.validUntil) : "–"}
                    {c.state === "active" && c.daysLeft !== null && c.daysLeft > 0 && <span className="muted small"> ({c.daysLeft} pv)</span>}
                  </td>
                  <td>{fetchedText(c, meta.accounts)}</td>
                  <td className="num">
                    <span className="row-actions">
                      {canReconnect(c) && (
                        <button className="btn btn-small" type="button" disabled={busy !== null} onClick={() => reconnect(c)}>
                          Yhdistä uudelleen
                        </button>
                      )}
                      {c.state === "active" && (
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
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !picking && <p className="muted">Ei pankkiyhteyksiä.</p>
      )}

      {history.length > 0 && (
        <details className="connection-history">
          <summary className="small muted">Aiemmat yhteydet ({history.length})</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pankki</th>
                  <th>Yhdistetty</th>
                  <th>Haettu</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((c) => (
                  <tr key={c.id}>
                    <td>{c.institution}</td>
                    <td>{date(c.createdAt)}</td>
                    <td>{dateTime(c.lastSyncedAt)}</td>
                    <td className="num">
                      <button
                        className="btn btn-small"
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          run(`forget-${c.id}`, async () => {
                            await api(`/api/connections/history/${encodeURIComponent(c.id)}`, { method: "DELETE" });
                          })
                        }
                      >
                        Poista listalta
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {meta.bank.configured && (
        <details open={pasteOpen || undefined} onToggle={(e) => setPasteOpen(e.currentTarget.open)}>
          <summary className="small muted">{mode === "paste" ? "Jos pankki näyttää virhesivun" : "Jos paluusivu ei aukea"}</summary>
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
