/** The block of Asetukset > Palvelin > Etäkäyttö that holds Cloudflare's API token: the saved one, or the field for a new one. */
import type { RefObject } from "react";
import { dateTime } from "../../format.ts";
import type { RemoteAccessState } from "./remote-access-api.ts";
import { canRemoveToken, helperProblem, tokenNeededForOff, zonesSentence } from "./remote-access-model.ts";
import { TokenGuide } from "./RemoteAccessGuide.tsx";

export interface TokenBlockProps {
  s: RemoteAccessState;
  /** The token lives in this field only. */
  field: RefObject<HTMLInputElement | null>;
  hasToken: boolean;
  replacing: boolean;
  onTyped: (filled: boolean) => void;
  onReplace: () => void;
  onCancelReplace: () => void;
  /** The field holds a token: ask for the password. */
  onSave: () => void;
  /** Ask for the password before the saved token is removed. */
  onRemove: () => void;
}

export function TokenBlock({ s, field, hasToken, replacing: replacingAsked, onTyped, onReplace, onCancelReplace, onSave, onRemove }: TokenBlockProps) {
  // without a working maintenance helper the token cannot be used: only a saved one is listed, so it can still be removed
  const helperReady = helperProblem(s) === null;
  if (!helperReady && !(s.token.saved && s.token.usable)) return null;
  const replacing = helperReady && replacingAsked;
  const showForm = helperReady && (!s.token.saved || !s.token.usable || replacing);
  // the server refuses a removal while remote access is on (409): the off takes the address out of Cloudflare with the token
  const removable = canRemoveToken(s) && !s.access.on;
  return (
    <div className="remote-block">
      <h4 className="field-label">Cloudflaren API-tunniste (API Token)</h4>
      {s.token.saved && s.token.usable && !replacing && (
        <>
          <p>
            Tallennettu {dateTime(s.token.savedAt)}. {zonesSentence(s.token.zones)}
          </p>
          {(s.access.on || tokenNeededForOff(s)) && <p className="small muted">Tunniste tarvitaan, kun etäkäyttö otetaan pois käytöstä.</p>}
          <div className="form-row">
            {helperReady && (
              <button className="btn" type="button" onClick={onReplace}>
                Vaihda tunniste
              </button>
            )}
            {removable && (
              <button className="btn btn-danger" type="button" onClick={onRemove}>
                Poista tunniste
              </button>
            )}
          </div>
          {!canRemoveToken(s) && <p className="small muted">Tunnisteen voi poistaa, kun muutos on valmis.</p>}
        </>
      )}
      {s.token.saved && !s.token.usable && <div className="notice warning">Tallennettua tunnistetta ei voi enää avata. Tallenna se uudelleen.</div>}
      {!s.token.saved && <p className="small muted">Tallenna tunniste ensin, niin etäkäytön voi ottaa käyttöön. Tunnistetta ei näytetä tallennuksen jälkeen.</p>}
      {showForm && (
        <>
          <TokenGuide />
          <form
            className="setup-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (hasToken) onSave();
            }}
          >
            <label>
              <span className="field-label">API-tunniste</span>
              <input ref={field} name="cloudflare-api-token" type="password" autoComplete="off" spellCheck={false} maxLength={300} onChange={(e) => onTyped(e.target.value.trim() !== "")} />
            </label>
            <div className="form-row">
              <button className="btn btn-primary" type="submit" disabled={!hasToken}>
                Tallenna tunniste
              </button>
              {s.token.saved && s.token.usable && (
                <button className="btn" type="button" onClick={onCancelReplace}>
                  Peruuta
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
