/** The blocks of Asetukset > Palvelin > Etäkäyttö that only tell where things stand. */
import { dateTime } from "../../format.ts";
import type { RemoteAccessState } from "./remote-access-api.ts";
import { isInstallerHost, onTrial, stageOf, tunnelUrl } from "./remote-access-model.ts";
import { Reverted, Trial } from "./RemoteAccessTrial.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { SETTINGS_ANCHOR, settingsCardHash } from "../../routes.ts";
import { t } from "../../text.ts";
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
