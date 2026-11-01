/**
 * Asetukset > Palvelin > Etäkäyttö (admin only).
 * Decision: whether the copy can be reached from outside the home network, and by whom. The admin turns it on, changes
 * the allowed emails and turns it off here instead of at a shell on the server; a member never sees the section.
 */
import { FoldCard } from "../../components/ui/FoldCard.tsx";
import { useRef, useState } from "react";
import { ApiError } from "../../api.ts";
import { PasswordDialog } from "../../components/ops/PasswordDialog.tsx";
import { usePolled } from "../../components/ops/use-polled.ts";
import "../../styles/remote-access.css";
import "../../styles/settings.css";
import { REMOTE_ACCESS_PATH, type RemoteAccessState, remoteAccessCalls, saveTokenFrom } from "./remote-access-api.ts";
import { canTurnOff, nextStep, canTurnOn, homeStoppedAnswering, needsLocalChoice, pollDelay, remoteSummary, stageOf, startEmails, startHostname } from "./remote-access-model.ts";
import { AfterOff, OffAsk, OnAsk, RemoveTokenAsk } from "./RemoteAccessAsk.tsx";
import { TurnOnForm } from "./RemoteAccessForm.tsx";
import { Status } from "./RemoteAccessStatus.tsx";
import { TokenBlock } from "./RemoteAccessToken.tsx";
import { HomeBlocked } from "./RemoteAccessTrial.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";
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
