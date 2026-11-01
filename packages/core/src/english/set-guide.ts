/** The English table of set-guide; the Finnish one it must match is in ../messages-set-guide.ts. */
import type { FI_SET_GUIDE } from "../messages-set-guide.ts";

export const EN_SET_GUIDE: Record<keyof typeof FI_SET_GUIDE, string> = {
  "set.guide.how_to_make_the_api_token": "How to make the API token in Cloudflare",
  "set.guide.you_need_a_cloudflare_account": "You need the Cloudflare account that holds your domain. The domain must be active in Cloudflare (status Active), and the account must have Zero Trust (the Free plan is enough).",
  "set.guide.open_page_and_sign_in": "Open {link} and sign in. Choose Create Token and then Custom token.",
  "set.guide.cloudflare_api_tokens_page": "Cloudflare's API tokens page",
  "set.guide.name_the_token": "Give the token a name, for example Omatalous.",
  "set.guide.add_these_five_permissions": "Add these five permissions. Each is chosen from the menus in the same order as in its name.",
  "set.guide.limit_the_token": "Limit the token to the account and domain you use for remote access.",
  "set.guide.create_and_copy": "Create the token and copy it at once. Cloudflare shows it only once.",
  "set.guide.paste_and_save": "Paste the token into the field below and press Save token.",
};
