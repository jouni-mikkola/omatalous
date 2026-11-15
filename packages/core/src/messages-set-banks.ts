/**
 * The catalogue of Asetukset: banks.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_BANKS = {
  "set.banks.one_new_transaction": "{count} uusi tapahtuma",
  "set.banks.n_new_transactions": "{count} uutta tapahtumaa",
  "set.banks.pick_title": "Valitse pankki",
  "set.banks.pick_close": "Sulje",
  "set.banks.pick_none_admin": "Enable Banking -sovelluksesi pankkilistalla ei ole pankkeja, joita Omatalous tukee. Tarkista sovellus kohdassa {link}.",
  "set.banks.pick_app_section": "Enable Banking -sovellus",
  "set.banks.pick_none_member": "Enable Banking -sovelluksen pankkilistalla ei ole pankkeja, joita Omatalous tukee. Ylläpitäjän pitää tarkistaa sovellus.",
  "set.banks.pick_search": "Hae pankkia",
  "set.banks.pick_connect": "Yhdistä {bank}",
  "set.banks.pick_opening": "Avataan…",
  "set.banks.pick_last_used": "Viimeksi käytetty",
  "set.banks.pick_no_match": "Haulla ei löydy pankkia.",
  "set.banks.pick_other_banks": "Luokittelemme muiden pankkien kuin Nordean tapahtumat pankin omien koodien mukaan. Tarkista ensimmäisen kuukauden kategoriat.",
} as const;
