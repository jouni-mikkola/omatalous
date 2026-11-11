/** Asetukset > Palvelin > Etäkäyttö: where things stand, the trial of a new address, and the home that stopped answering. */
import "../../styles/remote-access.css";
import "../../styles/settings.css";
import { type RemoteAccessState } from "./remote-access-api.ts";
import {
  isInstallerHost,
  onTrial,
  stageOf,
  trialOverdue,
  tunnelHost,
  tunnelUrl,
} from "./remote-access-model.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { clockTime, dateTime } from "../../format.ts";
import { SETTINGS_ANCHOR, settingsCardHash } from "../../routes.ts";
import { rich, t } from "../../text.ts";

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
export function Status({ s, down, onCancel, now }: { s: RemoteAccessState; down: boolean; onCancel: (requestId: string) => void; now: number }) {
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
export function HomeBlocked({ s }: { s: RemoteAccessState }) {
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
