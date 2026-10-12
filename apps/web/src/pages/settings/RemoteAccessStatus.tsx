/** The blocks of Asetukset > Palvelin > Etäkäyttö that only tell where things stand. */
import { Command } from "../../components/ops/HelperStatus.tsx";
import { dateTime } from "../../format.ts";
import type { RemoteAccessState } from "./remote-access-api.ts";
import { isInstallerHost, onTrial, stageOf, TUNNEL_GUIDE, tunnelUrl } from "./remote-access-model.ts";
import { Reverted, Trial } from "./RemoteAccessTrial.tsx";

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
    <div className="notice" role="status">
      <strong>{pending.status === "running" ? "Muutos on käynnissä." : "Muutos odottaa ylläpitoapuria."}</strong>
      <p>
        {pending.want === "tunnel" ? `Etäkäyttö otetaan käyttöön${pending.hostname ? ` osoitteessa ${pending.hostname}` : ""}.` : "Etäkäyttö otetaan pois käytöstä."} Tämä sivu päivittyy, kun muutos on
        valmis. <a href="#/settings?section=maintenance">Katso Ylläpito</a>
      </p>
      {takesHomeAway && pending.hostname && (
        <p>
          Kun muutos on tehty, kotiverkon osoite ei enää vastaa. Avaa silloin {tunnelUrl(pending.hostname)} ja kirjaudu sisään Cloudflaren kautta 15 minuutin kuluessa.
        </p>
      )}
      {down && <p>Yhteys sovellukseen katkesi hetkeksi. Sovellus käynnistyy uudelleen muutoksen aikana. Jos et pääse takaisin, avaa se kotiverkon osoitteella.</p>}
      {pending.status === "queued" && (
        <div className="form-row">
          <button className="btn btn-small" type="button" onClick={() => onCancel(pending.requestId)}>
            Peruuta muutos
          </button>
        </div>
      )}
    </div>
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
  return <>Lista on tehty palvelimella asennusohjelmalla, eikä se näy täällä.</>;
}

/** Where remote access stands: off, on (or on trial) with the address and who gets in, left over in Cloudflare, or not possible here. */
function Standing({ s, now }: { s: RemoteAccessState; now: number }) {
  const stage = stageOf(s);
  const note = s.cloudflare.note;
  if (stage === "domain") {
    return <div className="notice warning">Tällä asennuksella on oma verkkotunnus (Caddy), eikä etäkäyttöä oteta käyttöön sen rinnalle.</div>;
  }
  if (stage === "on") {
    const trial = onTrial(s);
    return (
      <div className={`notice ${trial ? "warning" : "good"}`} role="status">
        <strong>{trial ? "Uusi osoite on kokeilussa." : "Etäkäyttö on käytössä."}</strong>
        {trial && <Trial s={s} now={now} />}
        <dl className="remote-facts">
          <dt>Osoite</dt>
          <dd>{s.access.address ? <Address value={s.access.address} /> : (s.access.hostname ?? "")}</dd>
          <dt>Sallitut sähköpostiosoitteet</dt>
          <dd>
            <Allowed s={s} />
          </dd>
        </dl>
        {!s.access.checked && <p>Sovellus ei tarkista itse, että kävijä on kirjautunut Cloudflaren kautta.</p>}
        {isInstallerHost(s) && <p>Tämän osoitteen etäkäyttö on tehty palvelimella asennusohjelmalla, eikä sitä voi muuttaa täältä. Muuta sitä palvelimella asennusohjelmalla (./scripts/install.sh). Täältä sen voi ottaa pois käytöstä.</p>}
        {note && <p>{note}</p>}
      </div>
    );
  }
  if (stage === "left") {
    const removing = s.cloudflare.removal === "waiting";
    return (
      <div className="notice warning" role="status">
        <strong>{removing ? "Etäkäyttö otetaan pois käytöstä." : `Cloudflaressa on osoite ${s.cloudflare.hostname}, mutta sovellus ei ole sen takana.`}</strong>
        {note && <p>{note}</p>}
        {!removing && !note && <p>Ota etäkäyttö uudelleen käyttöön tai ota se pois käytöstä.</p>}
      </div>
    );
  }
  return (
    <div className="notice" role="status">
      <strong>Etäkäyttö ei ole käytössä.</strong>
      {s.access.address && <p>Sovelluksen osoite on nyt {s.access.address}.</p>}
      {note && <p>{note}</p>}
    </div>
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
        <div className="notice warning" role="alert">
          <strong>Edellinen muutos ei onnistunut.</strong>
          <p>{s.last.summary}</p>
          <p className="small muted">{dateTime(s.last.at)}</p>
        </div>
      )}
    </>
  );
}

/** A helper that is missing or too old: the command that sets it up and where to read how it is done, and no form. */
export function HelperMissing({ s }: { s: RemoteAccessState }) {
  return (
    <div className="notice warning" role="status">
      <p>Ota ylläpitoapuri käyttöön palvelimella:</p>
      <Command text={s.helper.enableCommand} />
      <p>
        <a href={TUNNEL_GUIDE} target="_blank" rel="noopener noreferrer">
          Ohje
        </a>
      </p>
    </div>
  );
}
