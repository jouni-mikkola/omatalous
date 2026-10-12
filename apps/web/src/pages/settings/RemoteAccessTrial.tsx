/**
 * The new address on trial: the server takes it off by itself unless somebody opens it and signs in through Cloudflare
 * in time. Also what the page says when that has happened, and when the home address has stopped answering.
 */
import { dateTime } from "../../format.ts";
import type { RemoteAccessState } from "./remote-access-api.ts";
import { clockTime, trialOverdue, tunnelHost, tunnelUrl } from "./remote-access-model.ts";

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
  return <p>Jos kukaan ei ole päässyt sisään siihen mennessä, palvelin ottaa osoitteen itse pois käytöstä, ja sovellus vastaa taas kotiverkon osoitteessa.</p>;
}

/** On, and nobody has come in through the new address yet. `now` is the clock the overdue test reads. */
export function Trial({ s, now }: { s: RemoteAccessState; now: number }) {
  const host = tunnelHost(s);
  const at = s.access.revertAt;
  const overdue = trialOverdue(at, now);
  return (
    <>
      {at === null && (
        <p>
          Avaa {host ? <Link host={host} /> : "uusi osoite"} ja kirjaudu sisään Cloudflaren kautta 15 minuutin kuluessa.
        </p>
      )}
      {at !== null && !overdue && (
        <p>
          Avaa {host ? <Link host={host} /> : "uusi osoite"} kerran ja kirjaudu sisään Cloudflaren kautta ennen kello {clockTime(at)}.
        </p>
      )}
      {at !== null && overdue && (
        <p>
          Kokeiluaika päättyi kello {clockTime(at)}. Jos palvelin ei ole vielä ottanut osoitetta pois käytöstä, avaa {host ? <Link host={host} /> : "uusi osoite"} ja kirjaudu sisään Cloudflaren kautta.
        </p>
      )}
      {!overdue && <IfNobody />}
      {overdue && <p>Jos kukaan ei ole päässyt sisään, palvelin ottaa osoitteen pois käytöstä heti, kun ylläpitoapuri ehtii.</p>}
    </>
  );
}

/**
 * The server took a new address off by itself. A calm sentence, the address, what to check, and the time.
 * `last.summary` is the server's fixed sentence; this says the same with the address and the next step.
 */
export function Reverted({ last }: { last: NonNullable<RemoteAccessState["last"]> }) {
  return (
    <div className="notice warning" role="status">
      <strong>Uusi osoite ei toiminut, joten etäkäyttö otettiin pois käytöstä.</strong>
      <p>
        {last.hostname ? `Osoitteella ${last.hostname} ` : "Uudella osoitteella "}
        kukaan ei päässyt sisään 15 minuutissa. Sovellus vastaa taas kotiverkon osoitteessa.
      </p>
      <p>Tarkista, että sähköpostiosoitteet on kirjoitettu oikein ja että verkkotunnuksen DNS-asetukset ovat Cloudflaressa kunnossa. Ota etäkäyttö sitten uudelleen käyttöön.</p>
      <p className="small muted">{dateTime(last.at)}</p>
    </div>
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
    <div className="notice warning" role="status">
      <strong>Etäkäyttö on otettu käyttöön, eikä kotiverkon osoite enää vastaa.</strong>
      <p>
        Avaa <Link host={host} /> {proven ? "ja kirjaudu sisään Cloudflaren kautta." : "ja kirjaudu sisään Cloudflaren kautta 15 minuutin kuluessa."}
      </p>
      {!proven && <p>Jos kukaan ei pääse sisään, palvelin ottaa osoitteen itse pois käytöstä, ja sovellus vastaa taas kotiverkon osoitteessa.</p>}
      <p className="small muted">Kun kotiverkon osoite vastaa taas, lataa tämä sivu uudelleen.</p>
    </div>
  );
}
