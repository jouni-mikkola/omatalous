/**
 * Asetukset > Palvelin > Etäkäyttö (admin only).
 * Decision: whether the copy can be reached from outside the home network, and by whom. The admin turns it on, changes
 * the allowed emails and turns it off here instead of at a shell on the server; a member never sees the section.
 * The whole form is this file: the card and its dialogs first, then the blocks it shows, in the order of the page
 * (where things stand, the trial of a new address, the API token and its guide, the address form, the yes-steps).
 */
import { FoldCard } from "../../components/ui/FoldCard.tsx";
import { type FormEvent, useRef, useState } from "react";
import { ApiError } from "../../api.ts";
import { PasswordDialog } from "../../components/ops/PasswordDialog.tsx";
import { usePolled } from "../../components/ops/use-polled.ts";
import "../../styles/remote-access.css";
import "../../styles/settings.css";
import { REMOTE_ACCESS_PATH, type RemoteAccessState, remoteAccessCalls, saveTokenFrom } from "./remote-access-api.ts";
import {
  afterOffKind,
  canTurnOff,
  canTurnOn,
  cleanHostname,
  emailProblem,
  homeStoppedAnswering,
  needsLocalChoice,
  nextStep,
  parseEmails,
  pollDelay,
  remoteSummary,
  stageOf,
  startEmails,
  startHostname,
  tunnelUrl,
} from "./remote-access-model.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { rich, t } from "../../text.ts";
import { HomeBlocked, Status } from "./RemoteAccessStatus.tsx";
import { TokenBlock } from "./RemoteAccessToken.tsx";
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
