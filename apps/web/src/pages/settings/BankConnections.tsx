/**
 * The member's bank consents: "Yhdistä pankki" opens a bank picker
 * (components/BankPicker.tsx: the banks the server offers), the list
 * shows each consent's validity and the accounts it reads (name and IBAN, so two consents of one holder differ),
 * and a fallback finishes a consent whose redirect page did not open. Every consent has "Yhdistä uudelleen", which starts
 * the same bank again, and a calendar file with a reminder before it ends. After a link the page lists the accounts
 * the bank handed over that Enable Banking does not let the app read, and offers the next bank, and asks who uses a new
 * joint account (LinkQuestion, on that visit only).
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import { bankIdForInstitution, logoForInstitution } from "../../banks.ts";
import { BankLogo } from "../../components/BankLogo.tsx";
import { BankPicker, lastUsedBank } from "../../components/BankPicker.tsx";
import { CONTROL_PANEL, reminderDay, renewalReminder, unlinkedAccounts, unlinkedStep, unlinkedTitle, validityText, WARN_DAYS } from "../../consent-notices.ts";
import { accountNumber, date, dateTime, plural } from "../../format.ts";
import type { Account, BankOption, Connection, Meta } from "../../types.ts";
import { LinkQuestion } from "./AccountUse.tsx";

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
 * True while an active consent has no answer yet: an account not fetched (and with no stopping problem), or no account
 * at all, which is how a consent looks before its first fetch has listed them. The page looks again while this holds.
 */
export function waitsForFirstFetch(connections: readonly Pick<Connection, "id" | "state">[], accounts: readonly Pick<Account, "connectionId" | "lastSyncedAt" | "problem">[]): boolean {
  return connections
    .filter((c) => c.state === "active")
    .some((c) => {
      const own = accounts.filter((a) => a.connectionId === c.id);
      return own.length === 0 || own.some((a) => !a.lastSyncedAt && !a.problem);
    });
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

/**
 * What a renewal starts: the consent's own bank at once, found by the name the bank reported. Null opens the picker:
 * the bank is no longer offered, or no application can start a bank yet.
 */
export function renewalBank(banks: readonly BankOption[], institution: string, canStart: boolean): string | null {
  return canStart ? bankIdForInstitution(banks, institution) : null;
}

/** The small logo beside the name a consent carries; nothing for a bank without one. */
function InstitutionLogo({ name, banks }: { name: string; banks: readonly BankOption[] }) {
  const src = logoForInstitution(name, banks);
  return src ? <BankLogo src={src} name={name} size="sm" /> : null;
}

/** How many accounts the bank brought when the browser came back from it (`?connected=2` in the address), else null. */
function connectedInAddress(): number | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("connected");
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

/** Hands a text to the browser as a file. */
function saveFile(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function BankConnections({
  meta,
  pickerOpen,
  connected,
  onChange,
  onMessage,
  sync,
}: {
  meta: Meta;
  pickerOpen: boolean;
  /** The accounts a bank brought just now. Without it the address of the page tells (`?connected=`). */
  connected?: number | null;
  onChange: () => void;
  onMessage: (m: { tone: "good" | "warning"; text: string }) => void;
  /** Hae nyt, beside Yhdistä pankki: drawn only while a connection is active. The page runs the fetch. */
  sync?: { busy: boolean; disabled: boolean; start: () => void };
}) {
  const [picking, setPicking] = useState(pickerOpen);
  // a bank was linked on this visit: the next one is offered straight away
  const [linked, setLinked] = useState(() => ((connected === undefined ? connectedInAddress() : connected) ?? 0) > 0);
  const [focusSignal, setFocusSignal] = useState(0);
  const openPicker = () => {
    setPicking(true);
    setFocusSignal((n) => n + 1);
  };
  // the banner of an ended consent links here (#/settings?add=1) while the page may already be open
  useEffect(() => {
    if (pickerOpen) openPicker();
  }, [pickerOpen]);
  const [busy, setBusy] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const mode = meta.bank.redirectMode;
  // a consent that owns no account is not listed: its accounts moved to a newer one, or it never had any
  const current = meta.connections.filter((c) => !c.history);
  const isAdmin = meta.user.role === "admin";
  // an app that reads Inactive is not held back here: starting a connection tests it again and says what is wrong
  const canStart = meta.bank.configured || !!meta.bank.inactive;
  const accountsOf = (connectionId: string) => meta.accounts.filter((a) => a.connectionId === connectionId);
  // the accounts the bank handed over that Enable Banking does not let the app read: Control Panel > Link accounts
  const unlinked = unlinkedAccounts(meta.connections, meta.accounts);
  const canFix = isAdmin || meta.bank.source === "user";

  // The first fetch of a new connection runs after the bank sent the browser back. Until every account of an active
  // consent has an answer (fetched, or what stopped it) the page looks again, for a minute at most.
  const waiting = linked && waitsForFirstFetch(meta.connections, meta.accounts);
  const reload = useRef(onChange);
  reload.current = onChange;
  useEffect(() => {
    if (!waiting) return;
    let looked = 0;
    const timer = setInterval(() => (++looked > 12 ? clearInterval(timer) : reload.current()), 5000);
    return () => clearInterval(timer);
  }, [waiting]);

  // Set when this page is on its way to the bank: busy then stays set, so a late second press starts no second consent.
  const leaving = useRef(false);
  useEffect(() => {
    // the back button can restore this page as it was left, with the bank behind it
    const restored = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      leaving.current = false;
      setBusy(null);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const text = await fn();
      if (text) onMessage({ tone: "good", text });
      onChange();
    } catch (err) {
      onMessage({ tone: "warning", text: (err as Error).message });
    } finally {
      if (!leaving.current) setBusy(null);
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
        } else {
          leaving.current = true;
          window.location.href = url;
        }
      } catch (err) {
        tab?.close();
        throw err;
      }
    });
  };

  // Yhdistä uudelleen is on every consent, before it ends too: it starts the same bank again, one click, no picker. A bank
  // that is not on the list, or no Enable Banking application yet, opens the picker, which says what is missing.
  const reconnect = (c: Connection) => {
    const bank = renewalBank(meta.bank.banks, c.institution, canStart);
    if (bank) void connect(bank);
    else openPicker();
  };
  const canReconnect = (c: Connection) => c.state !== "removed";
  // the reminder is offered while its day has not passed
  const reminderOf = (c: Connection) => {
    const day = c.state === "active" ? reminderDay(c.validUntil) : null;
    return day && day >= (meta.today ?? "") ? day : null;
  };
  const saveReminder = (c: Connection) => {
    const reminder = renewalReminder(c, window.location.origin, new Date());
    if (reminder) saveFile(reminder.filename, reminder.ics, "text/calendar;charset=utf-8");
  };

  return (
    <>
    <div className="card" id="pankkiyhteydet">
      <div className="card-head">
        <div>
          <h2>Pankkiyhteydet</h2>
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          {sync && meta.connections.some((c) => c.status === "active") && (
            <button className="btn" type="button" disabled={sync.disabled} aria-busy={sync.busy || undefined} onClick={sync.start}>
              {sync.busy ? "Haetaan…" : "Hae nyt"}
            </button>
          )}
          {!picking && (
            <button className="btn btn-primary" type="button" onClick={openPicker}>
              {linked ? "Yhdistä toinen pankki" : "Yhdistä pankki"}
            </button>
          )}
        </div>
      </div>

      {picking && (
        <BankPicker
          banks={meta.bank.banks}
          lastUsed={lastUsedBank(meta.connections, meta.bank.banks)}
          starting={busy?.startsWith("connect-") ? busy.slice("connect-".length) : null}
          disabled={!canStart || busy !== null}
          isAdmin={isAdmin}
          focusSignal={focusSignal}
          onPick={(id) => void connect(id)}
          onClose={() => setPicking(false)}
        >
          {meta.bank.configured ? (
            <p className="small muted">Lisää jokainen tili ja luottokortti erikseen.</p>
          ) : meta.bank.inactive ? (
            <div className="notice warning">
              {CONNECT_ERRORS.inactive} Kun tilit on linkitetty, pankin valinta testaa yhteyden uudelleen.
            </div>
          ) : isAdmin ? (
            <div className="notice warning">
              Määritä ensin Enable Banking kohdassa Asetukset &gt; <a href="#/settings?section=server">Palvelin</a>.
            </div>
          ) : (
            <div className="notice warning">Ylläpitäjän pitää ensin ottaa pankkiyhteydet käyttöön.</div>
          )}
        </BankPicker>
      )}

      {unlinked.length > 0 && (
        <div className="notice warning unlinked" role="status">
          <p>{unlinkedTitle(unlinked.length)}</p>
          <ul>
            {unlinked.map((a) => (
              <li key={a.id}>{[new Set(unlinked.map((u) => u.institution)).size > 1 ? a.institution : "", a.name, a.number].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
          <p>
            {unlinkedStep(unlinked.length, canFix)}
            {canFix && (
              <>
                {" "}
                <a href={CONTROL_PANEL} target="_blank" rel="noopener noreferrer">
                  Avaa Control Panel
                </a>
              </>
            )}
          </p>
        </div>
      )}

      {current.length > 0 ? (
        <div className="table-wrap">
          <table className="conn-table ruled" role="table">
            <thead>
              <tr>
                <th>Pankki</th>
                <th>Tila</th>
                <th>Haettu</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {current.map((c) => (
                <tr key={c.id} role="row">
                  <td role="cell">
                    <span className="bank-cell">
                      <InstitutionLogo name={c.institution} banks={meta.bank.banks} />
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
                  <td role="cell" data-label="Tila">
                    {validityText(c) || connectionStateText(c)}
                    {c.state === "active" && c.daysLeft !== null && c.daysLeft <= WARN_DAYS && <span className="badge warn">vanhenee pian</span>}
                    {reminderOf(c) && (
                      <div className="small">
                        <button className="text-button" type="button" onClick={() => saveReminder(c)}>
                          Muistutus kalenteriin
                        </button>{" "}
                        <span className="muted">{date(reminderOf(c))}</span>
                      </div>
                    )}
                  </td>
                  <td role="cell" data-label="Haettu">{fetchedText(c, meta.accounts)}</td>
                  <td role="cell" className="num">
                    <span className="row-actions">
                      {canReconnect(c) && (
                        <button className="btn btn-small" type="button" disabled={busy !== null} aria-busy={busy === `connect-${renewalBank(meta.bank.banks, c.institution, canStart)}` || undefined} onClick={() => reconnect(c)}>
                          Yhdistä uudelleen
                        </button>
                      )}
                      {c.state === "active" && (
                        <button
                          className="btn btn-small btn-danger"
                          disabled={busy !== null}
                          aria-busy={busy === `del-${c.id}` || undefined}
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

      {meta.bank.configured && (
        <details open={pasteOpen || undefined} onToggle={(e) => setPasteOpen(e.currentTarget.open)}>
          <summary className="small muted">{mode === "paste" ? "Liitä pankin viimeisen sivun osoite" : "Viimeistele yhteys osoitteella"}</summary>
          <form
            className="form-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run("paste", async () => {
                const r = await api<{ accounts: number }>("/api/connections/complete", { method: "POST", body: { url: pasted } });
                setPasted("");
                setPasteOpen(false);
                if (r.accounts > 0) setLinked(true);
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
            <button className="btn" type="submit" disabled={busy !== null} aria-busy={busy === "paste" || undefined}>
              Viimeistele
            </button>
          </form>
        </details>
      )}
    </div>
    {linked && <LinkQuestion meta={meta} onChange={onChange} onSaved={onMessage} />}
    </>
  );
}
