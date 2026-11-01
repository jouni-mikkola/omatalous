/** The block of Asetukset > Palvelin > Etäkäyttö that holds Cloudflare's API token: the saved one, or the field for a new one. */
import type { RefObject } from "react";
import { dateTime } from "../../format.ts";
import type { RemoteAccessState } from "./remote-access-api.ts";
import { canRemoveToken, helperProblem, tokenNeededForOff, zonesSentence } from "./remote-access-model.ts";
import { TokenGuide } from "./RemoteAccessGuide.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";
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
      <h4 className="field-label">{t("set.rtoken.cloudflare_api_token")}</h4>
      {s.token.saved && s.token.usable && !replacing && (
        <>
          <p>
            {t("set.rtoken.saved_at", { at: dateTime(s.token.savedAt) })} {zonesSentence(s.token.zones)}
          </p>
          {(s.access.on || tokenNeededForOff(s)) && <p className="small muted">{t("set.rtoken.the_token_is_needed_when")}</p>}
          <div className="form-row">
            {helperReady && (
              <Button onClick={onReplace}>
                {t("set.rtoken.replace_token")}
              </Button>
            )}
            {removable && (
              <Button onClick={onRemove}>
                {t("set.rtoken.remove_token")}
              </Button>
            )}
          </div>
          {!canRemoveToken(s) && <p className="small muted">{t("set.rtoken.the_token_can_be_removed")}</p>}
        </>
      )}
      {s.token.saved && !s.token.usable && <Notice tone="warning">{t("set.rtoken.the_saved_token_can_no")}</Notice>}
      {!s.token.saved && <p className="small muted">{t("set.rtoken.save_the_token_first_then")}</p>}
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
              <span className="field-label">{t("set.rtoken.api_token")}</span>
              <input ref={field} name="cloudflare-api-token" type="password" autoComplete="off" spellCheck={false} maxLength={300} onChange={(e) => onTyped(e.target.value.trim() !== "")} />
            </label>
            <div className="form-row">
              <Button variant="primary" type="submit" disabled={!hasToken}>
                {t("set.rtoken.save_token")}
              </Button>
              {s.token.saved && s.token.usable && (
                <Button onClick={onCancelReplace}>
                  {t("set.rtoken.cancel")}
                </Button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
