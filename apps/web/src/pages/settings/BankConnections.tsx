/**
 * The member's bank consents: "Yhdistä pankki" opens a bank picker
 * (components/BankPicker.tsx: the banks the server offers), the list
 * shows each consent's validity and the accounts it reads (name and IBAN, so two consents of one holder differ),
 * and a fallback finishes a consent whose redirect page did not open. Every consent has "Yhdistä uudelleen", which starts
 * the same bank again, and a calendar file with a reminder before it ends. When two or more consents are due, one round
 * renews them all, one after the other (RenewalRound.tsx). After a link the page lists the accounts
 * the bank handed over that Enable Banking does not let the app read, and offers the next bank, and asks who uses a new
 * joint account (LinkQuestion, on that visit only).
 */
import { Table } from "../../components/table/Table.tsx";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import { bankIdForInstitution } from "../../banks.ts";
import { BankPicker, lastUsedBank } from "../../components/BankPicker.tsx";
import { WARN_DAYS, type RoundView } from "@banking/core";
import { CONTROL_PANEL, reminderDay, renewalReminder, unlinkedAccounts, unlinkedStep, unlinkedTitle, validityText } from "../../consent-notices.ts";
import { accountNumber, date, dateTime, localDay } from
 "../../format.ts";
import type { Account, BankOption, Connection, Meta } from "../../types.ts";
import { LinkQuestion } from "./AccountUse.tsx";
import { RenewalRound } from "./RenewalRound.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { SETTINGS_ANCHOR, settingsHash } from "../../routes.ts";
import { useLookAgain, waitsForFirstFetch } from "../../first-fetch.ts";
import { labelTable, rich, t, tn } from "../../text.ts";
/**
 * The bank callback sends only these codes (routes/bank.ts). The link reasons have the same words as LINK_FAILURES in
 * the server's connectors/link-state.ts, which a pasted address gets; anything else reads as "failed".
 */
export const CONNECT_ERRORS: Record<string, string> = labelTable({
  session: () => t("set.conn.the_sign_in_expired_sign"),
  setup: () => t("set.conn.bank_connections_are_not_in"),
  failed: () => t("set.conn.connecting_failed_try_again"),
  cancelled: () => t("set.conn.connecting_was_cancelled"),
  bank: () => t("set.conn.the_bank_cancelled_the_connection"),
  inactive: () => t("set.conn.enable_banking_does_not_yet"),
  app: () => t("set.conn.enable_banking_did_not_recognise"),
  refused: () => t("set.conn.enable_banking_refused_the_connection"),
  expired: () => t("set.conn.the_connection_expired_try_again"),
});

/** hasOwn: the code comes from the address bar, so "constructor" must not find an inherited value. */
export function connectError(code: string): string {
  return Object.hasOwn(CONNECT_ERRORS, code) ? CONNECT_ERRORS[code]! : CONNECT_ERRORS.failed!;
}

/** The Tila column: the same words as the notice and Tietojen laatu, and no date ahead for a consent that broke or ended before its date. */
export function connectionStateText(c: Pick<Connection, "state" | "validUntil">, today = ""): string {
  // an end marked before its date is no "vanhentui" with a date ahead
  if (c.state === "lapsed") return today && (c.validUntil ? localDay(c.validUntil) : "") > today ? t("set.conn.ended") : t("set.conn.expired_on", { date: date(c.validUntil) });
  if (c.state === "broken") return t("set.conn.broken");
  if (c.state === "removed") return t("set.conn.removed");
  return t("set.conn.in_use");
}

/** A consent that ended and has no newer one of its bank: Yhdistä uudelleen is the next step, and the row says why. */
export function renewalLine(c: Pick<Connection, "needsRenewal" | "replaced">): string | null {
  return c.needsRenewal && !c.replaced ? t("set.conn.the_bank_connection_ended") : null;
}

/**
 * The Päivitetty column: when the accounts of a consent were last fetched, or, while none was, why. A consent that ended
 * keeps the date of its last run.
 */
export function fetchedText(conn: Pick<Connection, "id" | "state" | "lastSyncedAt">, accounts: readonly Pick<Account, "connectionId" | "lastSyncedAt" | "problem">[]): string {
  const own = accounts.filter((a) => a.connectionId === conn.id);
  const last = own.reduce<string | null>((late, a) => (a.lastSyncedAt && (!late || a.lastSyncedAt > late) ? a.lastSyncedAt : late), null);
  if (last) return dateTime(last);
  if (conn.state !== "active" || !own.length) return dateTime(conn.lastSyncedAt);
  if (own.some((a) => a.problem?.kind === "not_linked")) return t("set.conn.not_added_in_the_control");
  if (own.some((a) => a.problem?.kind === "failed")) return t("set.conn.fetch_failed");
  return t("set.conn.waiting_for_the_first_fetch");
}

/**
 * The notice after a finished consent, from the callback or the pasted
 * address. Zero accounts is a warning: no transactions will ever come
 * until the accounts are linked in Enable Banking.
 */
export function connectedMessage(accounts: number): { tone: "good" | "warning"; text: string } {
  return accounts > 0
    ? { tone: "good", text: t("set.conn.connected", { accounts: tn(accounts, "set.conn.account_one", "set.conn.account_many") }) }
    : { tone: "warning", text: t("set.conn.the_bank_gave_no_accounts") };
}

/**
 * What a renewal starts: the consent's own bank at once, found by the name the bank reported. Null opens the picker:
 * the bank is no longer offered, or no application can start a bank yet.
 */
export function renewalBank(banks: readonly BankOption[], institution: string, canStart: boolean): string | null {
  return canStart ? bankIdForInstitution(banks, institution) : null;
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
  // the banner of an ended consent links here (#/settings/banks?add=1) while the page may already be open
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
  // a member of an install with no bank app (neither the administrator's nor their own key) and no consent left has no bank to pick: the statement file is the way on
  const noApp = !isAdmin && meta.bank.source === null && current.length === 0;
  // an app that reads Inactive is not held back here: starting a connection tests it again and says what is wrong
  const canStart = meta.bank.configured || !!meta.bank.inactive;
  const accountsOf = (connectionId: string) => meta.accounts.filter((a) => a.connectionId === connectionId);
  // the accounts the bank handed over that Enable Banking does not let the app read: Control Panel > Link accounts
  const unlinked = unlinkedAccounts(meta.connections, meta.accounts);
  const canFix = isAdmin || meta.bank.source === "user";

  // The first fetch of a new connection runs after the bank sent the browser back. Until every account of an active
  // consent has an answer (fetched, or what stopped it) the page looks again, for a minute at most.
  const waiting = linked && waitsForFirstFetch(meta.connections, meta.accounts);
  useLookAgain(waiting, onChange);

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

  // `which` names the bank when the press already knows it; the round's first press learns it from the server
  const connect = (bank: string, which: () => Promise<string> = async () => bank) => {
    // paste mode: the bank's last page is an error page whose address the user copies here, so the bank opens
    // in a new tab (from this click, or the popup blocker stops it) and this page stays with the paste box open
    const tab = mode === "paste" ? window.open("", "_blank") : null;
    return run(`connect-${bank}`, async () => {
      try {
        const { url } = await api<{ url: string }>("/api/connections/start", { method: "POST", body: { bank: await which(), returnTo: window.location.origin } });
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
  // the round: the server picks the consents that are due and the first one is started at once
  const startRound = () =>
    void connect("round", async () => {
      const round = await api<RoundView>("/api/connections/round", { method: "POST", body: {} });
      return round.consents.find((c) => !c.done)!.bank;
    });
  const closeRound = () => void run("round-close", () => api("/api/connections/round", { method: "DELETE" }).then(() => undefined));
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
          <h2>{t("set.conn.bank_connections")}</h2>
        </div>
        <div className="form-row flush">
          {sync && meta.connections.some((c) => c.status === "active") && (
            <Button disabled={sync.disabled} aria-busy={sync.busy || undefined} onClick={sync.start}>
              {sync.busy ? t("set.conn.fetching") : t("set.conn.fetch_now")}
            </Button>
          )}
          {!picking && !noApp && (
            <Button variant="primary" onClick={openPicker}>
              {linked ? t("set.conn.connect_another_bank") : t("set.conn.connect_a_bank")}
            </Button>
          )}
        </div>
      </div>

      {noApp && (
        <Notice tone="warning">
          {t("set.conn.no_app")} <a href={settingsHash("banks", SETTINGS_ANCHOR.statement)}>{t("start.statement")}</a>
        </Notice>
      )}

      {picking && !noApp && (
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
            <p className="small muted">{t("set.conn.add_each_account_and_credit")}</p>
          ) : meta.bank.inactive ? (
            <Notice tone="warning">
              {CONNECT_ERRORS.inactive} {t("set.conn.after_adding")}
            </Notice>
          ) : isAdmin ? (
            <Notice tone="warning">
              {rich("set.conn.set_up_app_first", {}, { app: <a href={settingsHash("banks", SETTINGS_ANCHOR.bankApp)}>{t("set.conn.eb_app")}</a> })}
            </Notice>
          ) : (
            <Notice tone="warning">{t("set.conn.the_administrator_must_first_turn")}</Notice>
          )}
        </BankPicker>
      )}

      <RenewalRound meta={meta} disabled={!canStart || busy !== null} busy={busy} onStart={startRound} onNext={(bank) => void connect(bank)} onClose={closeRound} />

      {unlinked.length > 0 && (
        <Notice tone="warning" className="unlinked" role="status">
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
                  {t("set.conn.open_control_panel")}
                </a>
              </>
            )}
          </p>
        </Notice>
      )}

      {current.length > 0 ? (
        <Table
          caption={t("set.conn.bank_connections")}
          rows={current}
          rowKey={(c) => c.id}
          columns={[
            {
              key: "bank",
              label: t("set.conn.bank"),
              kind: "text",
              rowHead: true,
              cell: (c) => (
                <>
                  <span className="bank-cell">{c.institution}</span>
                  {/* two consents of one bank are told apart by their accounts: the name and the IBAN or card number */}
                  <div className="conn-accounts">
                    {accountsOf(c.id).map((a) => (
                      <div key={a.id} className="sub muted small acc-line">
                        {[a.name, accountNumber(a)].filter(Boolean).join(" · ")}
                      </div>
                    ))}
                  </div>
                </>
              ),
            },
            {
              key: "state",
              label: t("set.conn.state"),
              kind: "text",
              cell: (c) => (
                <>
                  {validityText(c) || connectionStateText(c, meta.today)}
                  {c.state === "active" && c.daysLeft !== null && c.daysLeft <= WARN_DAYS && <span className="badge warn">{t("set.conn.expires_soon")}</span>}
                  {renewalLine(c) && <div>{renewalLine(c)}</div>}
                  {reminderOf(c) && (
                    <div className="small">
                      <Button variant="link" onClick={() => saveReminder(c)}>
                        {t("set.conn.add_a_reminder_to_the")}
                      </Button>{" "}
                      <span className="muted">{date(reminderOf(c))}</span>
                    </div>
                  )}
                </>
              ),
            },
            {
              key: "fetched",
              label: t("set.conn.updated"),
              kind: "text",
              cell: (c) => fetchedText(c, meta.accounts),
            },
            {
              key: "actions",
              label: t("set.conn.actions"),
              headHidden: true,
              kind: "text",
              className: () => "num",
              cell: (c) => (
                <span className="row-actions">
                  {canReconnect(c) && (
                    <Button variant={renewalLine(c) ? "primary" : "link"} disabled={busy !== null} aria-busy={busy === `connect-${renewalBank(meta.bank.banks, c.institution, canStart)}` || undefined} onClick={() => reconnect(c)}>
                      {t("set.conn.reconnect")}
                    </Button>
                  )}
                  {c.state === "active" && (
                    <Button
                      variant="link"
                      disabled={busy !== null}
                      aria-busy={busy === `del-${c.id}` || undefined}
                      onClick={() =>
                        run(`del-${c.id}`, async () => {
                          await api(`/api/connections/${encodeURIComponent(c.id)}`, { method: "DELETE" });
                          return t("set.conn.connection_removed");
                        })
                      }
                    >
                      {t("set.conn.remove")}
                    </Button>
                  )}
                </span>
              ),
            },
          ]}
        />
      ) : (
        !picking && <p className="muted">{t("set.conn.connect_a_bank_and_the")}</p>
      )}

      {meta.bank.configured && (
        <details open={pasteOpen || undefined} onToggle={(e) => setPasteOpen(e.currentTarget.open)}>
          <summary className="small muted">{mode === "paste" ? t("set.conn.paste_the_address_of_the") : t("set.conn.if_connecting_was_left_unfinished")}</summary>
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
              className="bank-return-input"
              placeholder={t("set.conn.paste_the_address_from_the")}
              aria-label={t("set.conn.the_address_the_bank_returned")}
              spellCheck={false}
              autoComplete="off"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              required
            />
            <Button type="submit" disabled={busy !== null} aria-busy={busy === "paste" || undefined}>
              {t("set.conn.finish")}
            </Button>
          </form>
        </details>
      )}
    </div>
    {linked && <LinkQuestion meta={meta} onChange={onChange} onSaved={onMessage} />}
    </>
  );
}
