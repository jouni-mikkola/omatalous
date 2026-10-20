/**
 * Asetukset > Palvelin > Etäkäyttö (admin only).
 * Decision: whether the copy can be reached from outside the home network, and by whom. The admin turns it on, changes
 * the allowed emails and turns it off here instead of at a shell on the server; a member never sees the section.
 */
import { useRef, useState } from "react";
import { ApiError } from "../../api.ts";
import { PasswordDialog } from "../../components/ops/PasswordDialog.tsx";
import { usePolled } from "../../components/ops/use-polled.ts";
import "../../styles/remote-access.css";
import "../../styles/settings.css";
import { REMOTE_ACCESS_PATH, type RemoteAccessState, remoteAccessCalls, saveTokenFrom } from "./remote-access-api.ts";
import { canTurnOff, canTurnOn, homeStoppedAnswering, needsLocalChoice, pollDelay, stageOf, startEmails, startHostname } from "./remote-access-model.ts";
import { AfterOff, OffAsk, OnAsk, RemoveTokenAsk } from "./RemoteAccessAsk.tsx";
import { TurnOnForm } from "./RemoteAccessForm.tsx";
import { Status } from "./RemoteAccessStatus.tsx";
import { TokenBlock } from "./RemoteAccessToken.tsx";
import { HomeBlocked } from "./RemoteAccessTrial.tsx";

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

export function RemoteAccess() {
  // a 403 is a member: asking again will not change it
  const poll = usePolled<RemoteAccessState>(REMOTE_ACCESS_PATH, pollDelay, (status) => status === 401 || status === 403);
  return <RemoteAccessBody poll={poll} />;
}

/** `now` is the clock the page compares the end of a trial with; tests give their own. */
export function RemoteAccessBody({ poll, now = Date.now() }: { poll: RemoteAccessPoll; now?: number }) {
  const { data: s, error, errorStatus } = poll;
  const stopped = homeStoppedAnswering(s, errorStatus);
  if (errorStatus === 401 || (errorStatus === 403 && !stopped)) return null;
  return (
    <div className="card remote-access" id="etakaytto">
      <div>
        <h2>Etäkäyttö</h2>
        <p>Etäkäytöllä sovellukseen pääsee kotiverkon ulkopuolelta.</p>
      </div>
      {error && !s && (
        <div className="notice warning" role="alert">
          {error}
        </div>
      )}
      {!s && !error && <div className="small muted">Ladataan…</div>}
      {s && (stopped ? <HomeBlocked s={s} /> : <Panel s={s} poll={poll} now={now} />)}
    </div>
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
        <div className="notice warning" role="alert">
          {message}
        </div>
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
          <h4 className="field-label">Ota etäkäyttö pois käytöstä</h4>
          {stage === "on" ? (
            <>
              <p>Kun etäkäyttö otetaan pois käytöstä, etäosoitteella avattu selain menettää yhteyden.</p>
              <AfterOff s={s} />
            </>
          ) : (
            <p>Kun etäkäyttö otetaan pois käytöstä, osoite poistetaan Cloudflaresta. Sovelluksen omaa osoitetta se ei muuta.</p>
          )}
          <div className="form-row">
            <button className="btn btn-danger" type="button" onClick={() => setAsk({ kind: "off" })}>
              Ota etäkäyttö pois käytöstä
            </button>
          </div>
        </div>
      )}

      {ask?.kind === "token" && (
        <PasswordDialog
          title="Tallenna API-tunniste"
          submitLabel="Tallenna"
          onCancel={() => {
            clearToken();
            setAsk(null);
          }}
          onSubmit={async (password) => {
            const field = tokenField.current;
            if (!field) throw new Error("Tunnistekenttä ei ole enää näkyvissä. Kirjoita tunniste uudelleen.");
            set(await saveTokenFrom(field, password));
            setHasToken(false);
            setReplacing(false);
            setAsk(null);
          }}
        >
          <p>Kirjoita salasanasi, niin tunniste tallennetaan.</p>
        </PasswordDialog>
      )}
      {ask?.kind === "removeToken" && (
        <PasswordDialog title="Poista API-tunniste" submitLabel="Poista tunniste" danger onCancel={close} onSubmit={(password) => send(() => remoteAccessCalls.removeToken(password))}>
          <RemoveTokenAsk s={s} />
        </PasswordDialog>
      )}
      {ask?.kind === "on" && (
        <PasswordDialog
          title={s.access.on ? "Tarkista sallitut sähköpostiosoitteet" : "Tarkista ennen käyttöönottoa"}
          submitLabel={s.access.on ? "Kyllä, tallenna lista" : "Kyllä, ota käyttöön"}
          onCancel={close}
          onSubmit={(password) => send(() => remoteAccessCalls.turnOn(ask.hostname, ask.emails, password))}
        >
          <OnAsk changing={s.access.on} hostname={ask.hostname} emails={ask.emails} />
        </PasswordDialog>
      )}
      {ask?.kind === "off" && (
        <PasswordDialog
          title="Ota etäkäyttö pois käytöstä"
          submitLabel="Ota pois käytöstä"
          danger
          onCancel={close}
          onSubmit={(password) => {
            // the choice is the admin's own: the server is asked for the server-only answer only after the tick
            if (needsLocalChoice(s) && !localChoice) return Promise.reject(new Error("Merkitse ensin, että ymmärrät sovelluksen vastaavan tämän jälkeen vain palvelimella itsellään."));
            return send(() => remoteAccessCalls.turnOff(password, needsLocalChoice(s) && localChoice));
          }}
        >
          <OffAsk s={s} choice={localChoice} onChoice={setLocalChoice} />
        </PasswordDialog>
      )}
    </>
  );
}
