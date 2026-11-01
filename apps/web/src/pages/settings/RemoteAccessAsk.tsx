/**
 * What the password dialogs of Asetukset > Palvelin > Etäkäyttö show before the call is sent: the address and every
 * email back, where the app answers after an off, and the choice that goes with a copy that would answer on the server
 * machine alone. The dialog's button is the yes.
 */
import type { RemoteAccessState } from "./remote-access-api.ts";
import { afterOffKind, needsLocalChoice, stageOf, tunnelUrl } from "./remote-access-model.ts";
import { rich, t } from "../../text.ts";

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
