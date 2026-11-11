/**
 * Asetukset > Palvelin > Etäkäyttö (admin only).
 * Decision: whether the copy can be reached from outside the home network, and by whom. The admin turns it on, changes
 * the allowed emails and turns it off here instead of at a shell on the server; a member never sees the section.
 * The whole form is this file: the card and its dialogs first, then the blocks it shows, in the order of the page
 * (where things stand, the trial of a new address, the API token and its guide, the address form, the yes-steps).
 */
import { FoldCard } from "../../components/ui/FoldCard.tsx";
import { type FormEvent, type RefObject, useRef, useState } from "react";
import { ApiError } from "../../api.ts";
import { PasswordDialog } from "../../components/ops/PasswordDialog.tsx";
import { usePolled } from "../../components/ops/use-polled.ts";
import "../../styles/remote-access.css";
import "../../styles/settings.css";
import { REMOTE_ACCESS_PATH, type RemoteAccessState, remoteAccessCalls, saveTokenFrom } from "./remote-access-api.ts";
import {
  afterOffKind,
  canRemoveToken,
  canTurnOff,
  canTurnOn,
  cleanHostname,
  emailProblem,
  helperProblem,
  homeStoppedAnswering,
  isInstallerHost,
  needsLocalChoice,
  nextStep,
  onTrial,
  parseEmails,
  pollDelay,
  remoteSummary,
  stageOf,
  startEmails,
  startHostname,
  TOKEN_PAGE,
  TOKEN_PERMISSIONS,
  tokenNeededForOff,
  trialOverdue,
  tunnelHost,
  tunnelUrl,
  zonesSentence,
} from "./remote-access-model.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { clockTime, dateTime } from "../../format.ts";
import { SETTINGS_ANCHOR, settingsCardHash } from "../../routes.ts";
import { rich, t } from "../../text.ts";
/** What the page reads from the poll: the state, or why there is none. */
export interface RemoteAccessPoll {
  data: RemoteAccessState | null;
  error: string | null;
  errorStatus: number | null;
  downSince: number | null;
  reload: () => unknown;
  set: (next: RemoteAccessState) => void;
}

type Ask = { kind: "token" } | { kind: "removeToken" } | { kind: "on"; hostname: string; emails: string[] } | { kind: "off" } | null;

/** The page holds the poll: the status line at its top reads the same answer as the card. A 403 is a member: asking again will not change it. */
export function useRemoteAccessPoll(): RemoteAccessPoll {
  return usePolled<RemoteAccessState>(REMOTE_ACCESS_PATH, pollDelay, (status) => status === 401 || status === 403);
}

/** `now` is the clock the page compares the end of a trial with; tests give their own. */
export function RemoteAccessBody({ poll, now = Date.now() }: { poll: RemoteAccessPoll; now?: number }) {
  const { data: s, error, errorStatus } = poll;
  const stopped = homeStoppedAnswering(s, errorStatus);
  if (errorStatus === 401 || (errorStatus === 403 && !stopped)) return null;
  // nothing is on or under way: the card is the offer, and it folds
  const idle = (s === null || (stageOf(s) === "off" && s.pending === null)) && !stopped;
  return (
    <FoldCard className="remote-access" id="etakaytto" title={t("set.remote.remote_access")} sub={s ? (stopped ? remoteSummary(s) : nextStep(s)) : undefined} folded={idle}>
      <p>{t("set.remote.remote_access_lets_you_reach")}</p>
      {error && !s && (
        <Notice tone="warning" role="alert">
          {error}
        </Notice>
      )}
      {!s && !error && <div className="small muted">{t("set.remote.loading")}</div>}
      {s && (stopped ? <HomeBlocked s={s} /> : <Panel s={s} poll={poll} now={now} />)}
    </FoldCard>
  );
}

function Panel({ s, poll, now }: { s: RemoteAccessState; poll: RemoteAccessPoll; now: number }) {
  const { set, reload, downSince } = poll;
  const stage = stageOf(s);
  const [ask, setAsk] = useState<Ask>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  // the explicit choice of an off that leaves the app on the server machine alone; asked again every time
  const [localChoice, setLocalChoice] = useState(false);
  // the token lives in this field only; it is read when the password has been given and emptied at once
  const tokenField = useRef<HTMLInputElement>(null);

  const clearToken = () => {
    if (tokenField.current) tokenField.current.value = "";
    setHasToken(false);
  };
  const close = () => {
    setLocalChoice(false);
    setAsk(null);
  };
  /**
   * A call made from a dialog. The answer is the new state. A 409 means something else is under way (a change, or
   * Cloudflare's side being removed in the background): the server's sentence stays in the dialog and the state is read
   * again, so the page shows what runs. The password is not kept, so the call is not repeated by itself.
   */
  const send = async (call: () => Promise<RemoteAccessState>) => {
    try {
      set(await call());
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) void reload();
      throw err;
    }
    close();
  };
  const cancel = async (requestId: string) => {
    setMessage(null);
    try {
      await remoteAccessCalls.cancel(requestId);
      await reload();
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  return (
    <>
      <Status s={s} down={downSince !== null && s.pending !== null} onCancel={(id) => void cancel(id)} now={now} />
      {message && (
        <Notice tone="warning" role="alert">
          {message}
        </Notice>
      )}

      {stage !== "domain" && (
        <TokenBlock
          s={s}
          field={tokenField}
          hasToken={hasToken}
          replacing={replacing}
          onTyped={setHasToken}
          onReplace={() => setReplacing(true)}
          onCancelReplace={() => {
            clearToken();
            setReplacing(false);
          }}
          onSave={() => setAsk({ kind: "token" })}
          onRemove={() => setAsk({ kind: "removeToken" })}
        />
      )}

      {/* a helper that is missing or too old, and the command that sets it up, stand in Ylläpito (HelperStatus) */}
      {canTurnOn(s) && (
        <TurnOnForm
          key={`${stage}|${startHostname(s).host}|${startEmails(s).join(",")}`}
          s={s}
          onSubmit={(hostname, emails) => {
            setMessage(null);
            setAsk({ kind: "on", hostname, emails });
          }}
        />
      )}
      {canTurnOff(s) && (
        <div className="remote-block">
          <h4 className="field-label">{t("set.remote.turn_remote_access_off")}</h4>
          {stage === "on" ? (
            <>
              <p>{t("set.remote.when_remote_access_is_turned")}</p>
              <AfterOff s={s} />
            </>
          ) : (
            <p>{t("set.remote.when_remote_access_is_turned_2")}</p>
          )}
          <div className="form-row">
            <Button onClick={() => setAsk({ kind: "off" })}>
              {t("set.remote.turn_remote_access_off")}
            </Button>
          </div>
        </div>
      )}

      {ask?.kind === "token" && (
        <PasswordDialog
          title={t("set.remote.save_api_token")}
          submitLabel={t("set.remote.save")}
          onCancel={() => {
            clearToken();
            setAsk(null);
          }}
          onSubmit={async (password) => {
            const field = tokenField.current;
            if (!field) throw new Error(t("set.remote.token_field_gone"));
            set(await saveTokenFrom(field, password));
            setHasToken(false);
            setReplacing(false);
            setAsk(null);
          }}
        >
          <p>{t("set.remote.enter_your_password_to_save")}</p>
        </PasswordDialog>
      )}
      {ask?.kind === "removeToken" && (
        <PasswordDialog title={t("set.remote.remove_api_token")} submitLabel={t("set.remote.remove_token")} danger onCancel={close} onSubmit={(password) => send(() => remoteAccessCalls.removeToken(password))}>
          <RemoveTokenAsk s={s} />
        </PasswordDialog>
      )}
      {ask?.kind === "on" && (
        <PasswordDialog
          title={s.access.on ? t("set.remote.check_the_allowed_email_addresses") : t("set.remote.check_before_turning_on")}
          submitLabel={s.access.on ? t("set.remote.save_list") : t("set.remote.turn_on")}
          onCancel={close}
          onSubmit={(password) => send(() => remoteAccessCalls.turnOn(ask.hostname, ask.emails, password))}
        >
          <OnAsk changing={s.access.on} hostname={ask.hostname} emails={ask.emails} />
        </PasswordDialog>
      )}
      {ask?.kind === "off" && (
        <PasswordDialog
          title={t("set.remote.turn_remote_access_off")}
          submitLabel={t("set.remote.turn_off")}
          danger
          onCancel={close}
          onSubmit={(password) => {
            // the choice is the admin's own: the server is asked for the server-only answer only after the tick
            if (needsLocalChoice(s) && !localChoice) return Promise.reject(new Error(t("set.remote.tick_first")));
            return send(() => remoteAccessCalls.turnOff(password, needsLocalChoice(s) && localChoice));
          }}
        >
          <OffAsk s={s} choice={localChoice} onChoice={setLocalChoice} />
        </PasswordDialog>
      )}
    </>
  );
}

// Where things stand: the blocks that only tell.

/** An address worth a link: the https one a tunnel gives. A home network address stays plain text. */
function Address({ value }: { value: string }) {
  if (!/^https:\/\/\S+$/.test(value)) return <code>{value}</code>;
  return (
    <a href={value} target="_blank" rel="noopener noreferrer">
      {value}
    </a>
  );
}

/** The change that waits for the helper. A queued one can be withdrawn. */
function Pending({ s, pending, down, onCancel }: { s: RemoteAccessState; pending: NonNullable<RemoteAccessState["pending"]>; down: boolean; onCancel: (requestId: string) => void }) {
  // a first turning on takes the home address away: say so while the page can still be read
  const takesHomeAway = pending.want === "tunnel" && !s.access.on && pending.hostname !== null;
  return (
    <Notice role="status">
      <strong>{pending.status === "running" ? t("set.rstatus.change_is_running") : t("set.rstatus.change_waits_for_helper")}</strong>
      <p>
        {pending.want === "tunnel"
          ? pending.hostname
            ? t("set.rstatus.turning_on_at", { host: pending.hostname })
            : t("set.rstatus.turning_on")
          : t("set.rstatus.turning_off")}{" "}
        {t("set.rstatus.page_updates")} <a href={settingsCardHash(SETTINGS_ANCHOR.maintenance)}>{t("set.rstatus.see_maintenance")}</a>
      </p>
      {takesHomeAway && pending.hostname && (
        <p>
          {t("set.rstatus.after_change_open", { url: tunnelUrl(pending.hostname) })}
        </p>
      )}
      {down && <p>{t("set.rstatus.the_connection_to_the_app")}</p>}
      {pending.status === "queued" && (
        <div className="form-row">
          <Button variant="link" onClick={() => onCancel(pending.requestId)}>
            {t("set.rstatus.cancel_the_change")}
          </Button>
        </div>
      )}
    </Notice>
  );
}

/** Who may sign in. A list this page did not set is never shown as an empty one. */
function Allowed({ s }: { s: RemoteAccessState }) {
  if (s.access.emailsKnown && s.access.emails.length > 0) {
    return (
      <ul className="remote-emails">
        {s.access.emails.map((email) => (
          <li key={email}>{email}</li>
        ))}
      </ul>
    );
  }
  return <>{t("set.rstatus.the_list_was_made_on")}</>;
}

/** Where remote access stands: off, on (or on trial) with the address and who gets in, left over in Cloudflare, or not possible here. */
function Standing({ s, now }: { s: RemoteAccessState; now: number }) {
  const stage = stageOf(s);
  const note = s.cloudflare.note;
  if (stage === "domain") {
    return <Notice tone="warning">{t("set.rstatus.this_installation_has_its_own")}</Notice>;
  }
  if (stage === "on") {
    const trial = onTrial(s);
    return (
      <Notice tone={trial ? "warning" : "good"} role="status">
        <strong>{trial ? t("set.rstatus.new_address_on_trial") : t("set.rstatus.remote_access_is_on")}</strong>
        {trial && <Trial s={s} now={now} />}
        <dl className="remote-facts">
          <dt>{t("set.rstatus.address")}</dt>
          <dd>{s.access.address ? <Address value={s.access.address} /> : (s.access.hostname ?? "")}</dd>
          <dt>{t("set.rstatus.allowed_email_addresses")}</dt>
          <dd>
            <Allowed s={s} />
          </dd>
        </dl>
        {!s.access.checked && <p>{t("set.rstatus.the_app_does_not_check")}</p>}
        {isInstallerHost(s) && <p>{t("set.rstatus.remote_access_was_turned_on")}</p>}
        {note && <p>{note}</p>}
      </Notice>
    );
  }
  if (stage === "left") {
    const removing = s.cloudflare.removal === "waiting";
    return (
      <Notice tone="warning" role="status">
        <strong>{removing ? t("set.rstatus.turning_off") : t("set.rstatus.left_in_cloudflare", { host: s.cloudflare.hostname ?? "" })}</strong>
        {note && <p>{note}</p>}
        {!removing && !note && <p>{t("set.rstatus.turn_remote_access_on_again")}</p>}
      </Notice>
    );
  }
  return (
    <Notice role="status">
      <strong>{t("set.rstatus.remote_access_is_off")}</strong>
      {s.access.address && <p>{t("set.rstatus.app_address_now", { address: s.access.address })}</p>}
      {note && <p>{note}</p>}
    </Notice>
  );
}

/** The state block: the change under way, else where things stand and how the last change ended. */
function Status({ s, down, onCancel, now }: { s: RemoteAccessState; down: boolean; onCancel: (requestId: string) => void; now: number }) {
  if (s.pending) return <Pending s={s} pending={s.pending} down={down} onCancel={onCancel} />;
  return (
    <>
      <Standing s={s} now={now} />
      {s.last?.outcome === "reverted" && !s.access.on && <Reverted last={s.last} />}
      {s.last?.outcome === "failed" && (
        <Notice tone="warning" role="alert">
          <strong>{t("set.rstatus.the_last_change_did_not")}</strong>
          <p>{s.last.summary}</p>
          <p className="small muted">{dateTime(s.last.at)}</p>
        </Notice>
      )}
    </>
  );
}

// The new address on trial: the server takes it off by itself unless somebody opens it and signs in through Cloudflare
// in time. Also what the page says when that has happened, and when the home address has stopped answering.

function Link({ host }: { host: string }) {
  const url = tunnelUrl(host);
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {url}
    </a>
  );
}

/** What happens if nobody comes in: said the same way before, during and after the turning on. */
function IfNobody() {
  return <p>{t("set.trial.if_nobody_signs_in_the")}</p>;
}

/** On, and nobody has come in through the new address yet. `now` is the clock the overdue test reads. */
function Trial({ s, now }: { s: RemoteAccessState; now: number }) {
  const host = tunnelHost(s);
  const at = s.access.revertAt;
  const overdue = trialOverdue(at, now);
  const link = host ? <Link host={host} /> : t("set.trial.new_address");
  return (
    <>
      {at === null && (
        <p>
          {rich("set.trial.open_link_within", {}, { link })}
        </p>
      )}
      {at !== null && !overdue && (
        <p>
          {rich("set.trial.open_link_once_before", { time: clockTime(at) }, { link })}
        </p>
      )}
      {at !== null && overdue && (
        <p>
          {rich("set.trial.trial_ended_open_link", { time: clockTime(at) }, { link })}
        </p>
      )}
      {!overdue && <IfNobody />}
      {overdue && <p>{t("set.trial.if_nobody_signs_in_the")}</p>}
    </>
  );
}

/**
 * The server took a new address off by itself. A calm sentence, the address, what to check, and the time.
 * `last.summary` is the server's fixed sentence; this says the same with the address and the next step.
 */
function Reverted({ last }: { last: NonNullable<RemoteAccessState["last"]> }) {
  return (
    <Notice tone="warning" role="status">
      <strong>{t("set.trial.the_new_address_did_not")}</strong>
      <p>
        {last.hostname ? t("set.trial.nobody_got_in_host", { host: last.hostname }) : t("set.trial.nobody_got_in_new")}
      </p>
      <p>{t("set.trial.check_that_the_email_addresses")}</p>
      <p className="small muted">{dateTime(last.at)}</p>
    </Notice>
  );
}

/**
 * The page was open at the home address and the server no longer lets it in (403 `Pääsy estetty.`, plain text): remote
 * access is on. Nothing is asked of the server again; the way on is the remote address.
 */
function HomeBlocked({ s }: { s: RemoteAccessState }) {
  const host = tunnelHost(s);
  if (!host) return null;
  const proven = s.access.on && s.access.confirmed;
  return (
    <Notice tone="warning" role="status">
      <strong>{t("set.trial.remote_access_is_on_home")}</strong>
      <p>{rich(proven ? "set.trial.open_link_proven" : "set.trial.open_link_unproven", {}, { link: <Link host={host} /> })}</p>
      {!proven && <p>{t("set.trial.if_nobody_signs_in_the")}</p>}
      <p className="small muted">{t("set.trial.when_the_home_network_address")}</p>
    </Notice>
  );
}

// Cloudflare's API token: the saved one, or the field for a new one.

interface TokenBlockProps {
  s: RemoteAccessState;
  /** The token lives in this field only. */
  field: RefObject<HTMLInputElement | null>;
  hasToken: boolean;
  replacing: boolean;
  onTyped: (filled: boolean) => void;
  onReplace: () => void;
  onCancelReplace: () => void;
  /** The field holds a token: ask for the password. */
  onSave: () => void;
  /** Ask for the password before the saved token is removed. */
  onRemove: () => void;
}

function TokenBlock({ s, field, hasToken, replacing: replacingAsked, onTyped, onReplace, onCancelReplace, onSave, onRemove }: TokenBlockProps) {
  // without a working maintenance helper the token cannot be used: only a saved one is listed, so it can still be removed
  const helperReady = helperProblem(s) === null;
  if (!helperReady && !(s.token.saved && s.token.usable)) return null;
  const replacing = helperReady && replacingAsked;
  const showForm = helperReady && (!s.token.saved || !s.token.usable || replacing);
  // the server refuses a removal while remote access is on (409): the off takes the address out of Cloudflare with the token
  const removable = canRemoveToken(s) && !s.access.on;
  return (
    <div className="remote-block">
      <h4 className="field-label">{t("set.rtoken.cloudflare_api_token")}</h4>
      {s.token.saved && s.token.usable && !replacing && (
        <>
          <p>
            {t("set.rtoken.saved_at", { at: dateTime(s.token.savedAt) })} {zonesSentence(s.token.zones)}
          </p>
          {(s.access.on || tokenNeededForOff(s)) && <p className="small muted">{t("set.rtoken.the_token_is_needed_when")}</p>}
          <div className="form-row">
            {helperReady && (
              <Button onClick={onReplace}>
                {t("set.rtoken.replace_token")}
              </Button>
            )}
            {removable && (
              <Button onClick={onRemove}>
                {t("set.rtoken.remove_token")}
              </Button>
            )}
          </div>
          {!canRemoveToken(s) && <p className="small muted">{t("set.rtoken.the_token_can_be_removed")}</p>}
        </>
      )}
      {s.token.saved && !s.token.usable && <Notice tone="warning">{t("set.rtoken.the_saved_token_can_no")}</Notice>}
      {!s.token.saved && <p className="small muted">{t("set.rtoken.save_the_token_first_then")}</p>}
      {showForm && (
        <>
          <TokenGuide />
          <form
            className="setup-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (hasToken) onSave();
            }}
          >
            <label>
              <span className="field-label">{t("set.rtoken.api_token")}</span>
              <input ref={field} name="cloudflare-api-token" type="password" autoComplete="off" spellCheck={false} maxLength={300} onChange={(e) => onTyped(e.target.value.trim() !== "")} />
            </label>
            <div className="form-row">
              <Button variant="primary" type="submit" disabled={!hasToken}>
                {t("set.rtoken.save_token")}
              </Button>
              {s.token.saved && s.token.usable && (
                <Button onClick={onCancelReplace}>
                  {t("set.rtoken.cancel")}
                </Button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}

/** The steps for making Cloudflare's API token, folded away until the admin needs them. */
function TokenGuide() {
  return (
    <details className="remote-guide">
      <summary>{t("set.guide.how_to_make_the_api_token")}</summary>
      <p className="small">{t("set.guide.you_need_a_cloudflare_account")}</p>
      <ol className="setup-steps">
        <li>
          {rich(
            "set.guide.open_page_and_sign_in",
            {},
            {
              link: (
                <a href={TOKEN_PAGE} target="_blank" rel="noopener noreferrer">
                  {t("set.guide.cloudflare_api_tokens_page")}
                </a>
              ),
            },
          )}
        </li>
        <li>{t("set.guide.name_the_token")}</li>
        <li>
          {t("set.guide.add_these_five_permissions")}
          <ul>
            {TOKEN_PERMISSIONS.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
        </li>
        <li>{t("set.guide.limit_the_token")}</li>
        <li>{t("set.guide.create_and_copy")}</li>
        <li>{t("set.guide.paste_and_save")}</li>
      </ol>
    </details>
  );
}

/** The address and who may sign in: turns remote access on, or, when it is on, changes the list. Both go through the yes-step. */
function TurnOnForm({ s, onSubmit }: { s: RemoteAccessState; onSubmit: (hostname: string, emails: string[]) => void }) {
  const start = startHostname(s);
  const [host, setHost] = useState(start.host);
  const [text, setText] = useState(startEmails(s).join("\n"));
  const [problem, setProblem] = useState<{ field: "host" | "emails"; text: string } | null>(null);
  const on = s.access.on;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const hostname = cleanHostname(host);
    if (!hostname) return setProblem({ field: "host", text: t("set.rform.enter_the_address_like_talous") });
    const emails = parseEmails(text);
    const bad = emailProblem(emails);
    if (bad) return setProblem({ field: "emails", text: bad });
    setProblem(null);
    onSubmit(hostname, emails);
  };

  return (
    <form className="setup-form remote-block" onSubmit={submit} noValidate>
      <h4 className="field-label">{on ? t("set.rform.change_the_allowed_email_addresses") : t("set.rform.turn_on_remote_access")}</h4>
      <label>
        <span className="field-label">{t("set.rform.address")}</span>
        <input
          name="hostname"
          type="text"
          value={host}
          readOnly={start.locked}
          onChange={(e) => setHost(e.target.value)}
          placeholder="talous.oma.fi"
          spellCheck={false}
          autoComplete="off"
          maxLength={253}
          aria-invalid={problem?.field === "host" ? true : undefined}
        />
        <span className="field-help">
          {start.locked
            ? t("set.rform.cannot_change_address")
            : t("set.rform.address_help")}
        </span>
        {problem?.field === "host" && <span className="field-error">{problem.text}</span>}
      </label>
      <label>
        <span className="field-label">{t("set.rform.allowed_email_addresses")}</span>
        <textarea
          name="emails"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={problem?.field === "emails" ? true : undefined}
        />
        <span className="field-help">
          {t("set.rform.one_per_line")} {on ? t("set.rform.removed_still_in") : t("set.rform.own_address_listed")}
        </span>
        {problem?.field === "emails" && <span className="field-error">{problem.text}</span>}
      </label>
      <div className="form-row">
        <Button variant="primary" type="submit">
          {on ? t("set.rform.save_allowed_addresses") : t("set.rform.turn_on_remote_access")}
        </Button>
      </div>
    </form>
  );
}

// What the password dialogs show before the call is sent: the address and every email back, where the app answers
// after an off, and the choice that goes with a copy that would answer on the server machine alone. The dialog's
// button is the yes. Exported for the tests of the page.

/** Every email, one a line, exactly as they will be sent. */
function EmailList({ emails }: { emails: string[] }) {
  return (
    <ul className="remote-emails">
      {emails.map((email) => (
        <li key={email}>{email}</li>
      ))}
    </ul>
  );
}

/** Turning on with an address, or, when it is on, a new list for the address that is on: the yes-step shows both back. */
export function OnAsk({ changing, hostname, emails }: { changing: boolean; hostname: string; emails: string[] }) {
  const url = tunnelUrl(hostname);
  if (changing) {
    return (
      <div className="remote-ask">
        <p>
          {rich("set.ask.only_these_can_sign_in", {}, { url: <strong>{url}</strong> })}
        </p>
        <EmailList emails={emails} />
        <p>{t("set.ask.this_change_has_no_trial")}</p>
        <p>{t("set.ask.the_removed_address_still_lets")}</p>
      </div>
    );
  }
  return (
    <div className="remote-ask">
      <p>{t("set.ask.remote_access_will_be_turned")}</p>
      <dl className="remote-facts">
        <dt>{t("set.ask.address")}</dt>
        <dd>{url}</dd>
        <dt>{t("set.ask.email_addresses")}</dt>
        <dd>
          <EmailList emails={emails} />
        </dd>
      </dl>
      <p>{t("set.ask.when_on_home_stops", { url })}</p>
      <p>{t("set.ask.the_new_address_is_first")}</p>
      <p>{t("set.ask.make_sure_your_own_email")}</p>
    </div>
  );
}

/** Where the app answers once the copy is out of the tunnel, shown before the yes. */
export function AfterOff({ s }: { s: RemoteAccessState }) {
  const after = s.access.afterOff;
  if (afterOffKind(s) === "home") return <p>{t("set.ask.afterwards_found_at", { after: after ?? "" })}</p>;
  if (after === null) return <p>{t("set.ask.the_maintenance_helper_does_not")}</p>;
  return <p>{t("set.ask.afterwards_server_only", { after })}</p>;
}

/** Off. A host behind the tunnel says where the app answers after it, and a server-only answer waits for a tick in the box. */
export function OffAsk({ s, choice, onChoice }: { s: RemoteAccessState; choice: boolean; onChoice: (checked: boolean) => void }) {
  if (stageOf(s) !== "on") return <p>{t("set.ask.the_address_is_removed_from")}</p>;
  return (
    <div className="remote-ask">
      <p>{t("set.ask.a_browser_opened_with_the")}</p>
      <AfterOff s={s} />
      {needsLocalChoice(s) && (
        <label className="check">
          {/* the browser itself holds the dialog back until it is ticked */}
          <input type="checkbox" name="local-only" checked={choice} required onChange={(e) => onChoice(e.target.checked)} />
          <span>{t("set.ask.i_understand_this_and_want")}</span>
        </label>
      )}
    </div>
  );
}

/** Removing the token. Cloudflare's side can only be removed with it, so that is said before the yes. */
export function RemoveTokenAsk({ s }: { s: RemoteAccessState }) {
  return (
    <div className="remote-ask">
      <p>{t("set.ask.the_api_token_is_removed")}</p>
      {s.cloudflare.hostname && <p>{t("set.ask.cloudflare_settings_need_token", { host: s.cloudflare.hostname })}</p>}
    </div>
  );
}
