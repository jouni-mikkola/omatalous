/** Asetukset > Palvelin > Etäkäyttö: the Cloudflare API token, the saved one or the field for a new one, and its guide. */
import { type RefObject } from "react";
import "../../styles/remote-access.css";
import "../../styles/settings.css";
import { type RemoteAccessState } from "./remote-access-api.ts";
import {
  canRemoveToken,
  helperProblem,
  TOKEN_PAGE,
  TOKEN_PERMISSIONS,
  tokenNeededForOff,
  zonesSentence,
} from "./remote-access-model.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { dateTime } from "../../format.ts";
import { rich, t } from "../../text.ts";

// Cloudflare's API token: the saved one, or the field for a new one.

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

/** The steps for making Cloudflare's API token, folded away until the admin needs them. */
function TokenGuide() {
  return (
    <details className="remote-guide">
      <summary>{t("set.guide.how_to_make_the_api_token")}</summary>
      <p className="small">{t("set.guide.you_need_a_cloudflare_account")}</p>
      <ol className="setup-steps">
        <li>
          {rich(
            "set.guide.open_page_and_sign_in",
            {},
            {
              link: (
                <a href={TOKEN_PAGE} target="_blank" rel="noopener noreferrer">
                  {t("set.guide.cloudflare_api_tokens_page")}
                </a>
              ),
            },
          )}
        </li>
        <li>{t("set.guide.name_the_token")}</li>
        <li>
          {t("set.guide.add_these_five_permissions")}
          <ul>
            {TOKEN_PERMISSIONS.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
        </li>
        <li>{t("set.guide.limit_the_token")}</li>
        <li>{t("set.guide.create_and_copy")}</li>
        <li>{t("set.guide.paste_and_save")}</li>
      </ol>
    </details>
  );
}
