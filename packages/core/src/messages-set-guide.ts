/**
 * The catalogue of Asetukset: guide.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_GUIDE = {
  "set.guide.how_to_make_the_api_token": "Luo API-tunniste Cloudflaressa",
  "set.guide.you_need_a_cloudflare_account": "Tarvitset Cloudflare-tilin, jolla verkkotunnuksesi on. Verkkotunnuksen pitää olla käytössä Cloudflaressa (tilana Active), ja tilillä pitää olla Zero Trust käytössä (ilmainen Free-taso riittää).",
  "set.guide.open_page_and_sign_in": "Avaa {link} ja kirjaudu sisään. Valitse Create Token ja sitten Custom token.",
  "set.guide.cloudflare_api_tokens_page": "Cloudflaren API-tunnisteiden sivu",
  "set.guide.name_the_token": "Anna tunnisteelle nimi, esimerkiksi Omatalous.",
  "set.guide.add_these_five_permissions": "Lisää nämä viisi oikeutta (Permissions). Valitse jokainen valikoista samassa järjestyksessä kuin nimessä.",
  "set.guide.limit_the_token": "Rajaa tunniste tiliin ja verkkotunnukseen, jota käytät etäkäyttöön.",
  "set.guide.create_and_copy": "Luo tunniste ja kopioi se heti. Cloudflare näyttää sen vain kerran.",
  "set.guide.paste_and_save": "Liitä tunniste alla olevaan kenttään ja paina Tallenna tunniste.",
} as const;
