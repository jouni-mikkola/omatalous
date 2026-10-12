/**
 * What the password dialogs of Asetukset > Palvelin > Etäkäyttö show before the call is sent: the address and every
 * email back, where the app answers after an off, and the choice that goes with a copy that would answer on the server
 * machine alone. The dialog's button is the yes.
 */
import type { RemoteAccessState } from "./remote-access-api.ts";
import { afterOffKind, needsLocalChoice, stageOf, tunnelUrl } from "./remote-access-model.ts";

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
          Osoitteessa <strong>{url}</strong> pääsee kirjautumaan vain näillä sähköpostiosoitteilla:
        </p>
        <EmailList emails={emails} />
        <p>Tämä muutos ei ole kokeilussa. Lista on voimassa heti, ja jos omaa sähköpostiosoitettasi ei ole siinä, et pääse enää sisään.</p>
        <p>Poistettu osoite pääsee silti sisään, kunnes sen avoin kirjautuminen Cloudflaressa päättyy.</p>
      </div>
    );
  }
  return (
    <div className="remote-ask">
      <p>Etäkäyttö otetaan käyttöön tällä osoitteella ja näille sähköpostiosoitteille.</p>
      <dl className="remote-facts">
        <dt>Osoite</dt>
        <dd>{url}</dd>
        <dt>Sähköpostiosoitteet</dt>
        <dd>
          <EmailList emails={emails} />
        </dd>
      </dl>
      <p>Kun etäkäyttö on päällä, kotiverkon osoite ei enää vastaa. Sovellukseen pääsee vain osoitteella {url}.</p>
      <p>Uusi osoite on ensin kokeilussa. Avaa se 15 minuutin kuluessa ja kirjaudu sisään Cloudflaren kautta jollakin listan osoitteella. Jos kukaan ei pääse sisään, palvelin ottaa etäkäytön itse pois käytöstä.</p>
      <p>Varmista, että oma sähköpostiosoitteesi on listalla ja että osoitteet on kirjoitettu oikein. Sovellus käynnistyy uudelleen muutoksen aikana.</p>
    </div>
  );
}

/** Where the app answers once the copy is out of the tunnel, shown before the yes. */
export function AfterOff({ s }: { s: RemoteAccessState }) {
  const after = s.access.afterOff;
  if (afterOffKind(s) === "home") return <p>Tämän jälkeen Omatalous löytyy osoitteesta {after}.</p>;
  if (after === null) return <p>Ylläpitoapuri ei kerro, mistä osoitteesta Omatalous löytyy tämän jälkeen, joten se voi vastata vain palvelimella itsellään.</p>;
  return <p>Tämän jälkeen Omatalous vastaa vain palvelimella itsellään, osoitteessa {after}. Kotiverkon muut laitteet eivät pääse siihen.</p>;
}

/** Off. A host behind the tunnel says where the app answers after it, and a server-only answer waits for a tick in the box. */
export function OffAsk({ s, choice, onChoice }: { s: RemoteAccessState; choice: boolean; onChoice: (checked: boolean) => void }) {
  if (stageOf(s) !== "on") return <p>Osoite poistetaan Cloudflaresta. Sovelluksen omaa osoitetta se ei muuta.</p>;
  return (
    <div className="remote-ask">
      <p>Etäosoitteella avattu selain menettää yhteyden.</p>
      <AfterOff s={s} />
      {needsLocalChoice(s) && (
        <label className="check">
          {/* the browser itself holds the dialog back until it is ticked */}
          <input type="checkbox" name="local-only" checked={choice} required onChange={(e) => onChoice(e.target.checked)} />
          <span>Ymmärrän tämän ja haluan ottaa etäkäytön pois käytöstä.</span>
        </label>
      )}
    </div>
  );
}

/** Removing the token. Cloudflare's side can only be removed with it, so that is said before the yes. */
export function RemoveTokenAsk({ s }: { s: RemoteAccessState }) {
  return (
    <div className="remote-ask">
      <p>Tallennettu API-tunniste poistetaan palvelimelta. Etäkäyttöön ei voi tehdä muutoksia, ennen kuin tallennat tunnisteen uudelleen.</p>
      {s.cloudflare.hostname && <p>Cloudflaren puolta (osoite {s.cloudflare.hostname}) ei voi poistaa ilman tunnistetta. Ota etäkäyttö ensin pois käytöstä.</p>}
    </div>
  );
}
