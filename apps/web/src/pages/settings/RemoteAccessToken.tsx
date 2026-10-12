/** The block of Asetukset > Palvelin > Etäkäyttö that holds Cloudflare's API token: the saved one, or the field for a new one. */
import type { RefObject } from "react";
import { dateTime } from "../../format.ts";
import type { RemoteAccessState } from "./remote-access-api.ts";
import { canRemoveToken, tokenNeededForOff, zonesSentence } from "./remote-access-model.ts";
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

export function TokenBlock({ s, field, hasToken, replacing, onTyped, onReplace, onCancelReplace, onSave, onRemove }: TokenBlockProps) {
  const showForm = !s.token.saved || !s.token.usable || replacing;
  return (
    <div className="remote-block">
      <h4 className="field-label">Cloudflaren API-tunniste (API Token)</h4>
      {s.token.saved && s.token.usable && !replacing && (
        <>
          <p>
            Tallennettu {dateTime(s.token.savedAt)}. {zonesSentence(s.token.zones)}
          </p>
          {tokenNeededForOff(s) && <p className="small muted">Etäkäytön poistamiseen tarvitaan tunniste. Poista tunniste vasta, kun etäkäyttö on otettu pois käytöstä.</p>}
          <div className="form-row">
            <button className="btn" type="button" onClick={onReplace}>
              Vaihda tunniste
            </button>
            {canRemoveToken(s) && (
              <button className="btn btn-danger" type="button" onClick={onRemove}>
                Poista tunniste
              </button>
            )}
          </div>
          {!canRemoveToken(s) && <p className="small muted">Tunnisteen voi poistaa, kun muutos on valmis.</p>}
        </>
      )}
      {s.token.saved && !s.token.usable && <div className="notice warning">Tallennettu tunniste ei enää aukea. Tallenna se uudelleen.</div>}
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
