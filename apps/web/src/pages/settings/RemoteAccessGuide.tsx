/** The steps for making Cloudflare's API token, folded away until the admin needs them. */
import { rich, t } from "../../text.ts";
import { TOKEN_PAGE, TOKEN_PERMISSIONS } from "./remote-access-model.ts";

export function TokenGuide() {
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
