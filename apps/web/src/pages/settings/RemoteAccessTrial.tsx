/**
 * The new address on trial: the server takes it off by itself unless somebody opens it and signs in through Cloudflare
 * in time. Also what the page says when that has happened, and when the home address has stopped answering.
 */
import { clockTime, dateTime } from "../../format.ts";
import type { RemoteAccessState } from "./remote-access-api.ts";
import { trialOverdue, tunnelHost, tunnelUrl } from "./remote-access-model.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import { rich, t } from "../../text.ts";
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
export function Trial({ s, now }: { s: RemoteAccessState; now: number }) {
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
export function Reverted({ last }: { last: NonNullable<RemoteAccessState["last"]> }) {
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
