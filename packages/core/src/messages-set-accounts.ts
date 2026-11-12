/**
 * The catalogue of Asetukset: accounts.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_ACCOUNTS = {
  "set.acc.account_name_removed": "Tili {name} poistettu.",
  "set.acc.type_of_account_name": "Tilin {name} tyyppi",
  "set.acc.saved": "Tallennettu.",
  "set.acc.over_the_credit_limit_by": ", yli luottorajan {amount}",
  "set.acc.loan_payment_account": "Lainanhoitotili",
  "set.acc.edit_account_name": "Muokkaa tiliä {name}",
  "set.acc.edit": "Muokkaa",
  "set.acc.account": "Tili",
  "set.acc.type": "Tyyppi",
  "set.acc.user": "Käyttäjä",
  "set.acc.balance": "Saldo",
  "set.acc.actions": "Toiminnot",
  "set.acc.accounts": "Tilit",
  "set.acc.remove_the_account_name": "Poista tili {name}?",
  "set.acc.remove_account": "Poista tili",
  "set.acc.the_account_s_transactions_are": "Poistamme myös tilin tapahtumat.",
  "set.acc.the_latest_fetch_failed_message": "Viimeisin haku epäonnistui: {message}",
  "set.acc.open_control_panel": "Avaa Control Panel",
  "set.acc.enter_the_balance_in_euros": "Anna saldo euroina, esimerkiksi 1 234,56.",
  "set.acc.balance_now": "Saldo nyt",
  "set.acc.saving": "Tallennetaan…",
  "set.acc.save": "Tallenna",
  "set.acc.cancel": "Peruuta",
  "set.acc.credit_limit": "Luottoraja {limit}",
  "set.acc.credit_used": ", käytössä {used}",
  "set.acc.bank_name": "Pankin nimi: {name}",
  "set.acc.bank_type": "Pankin tilityyppi: {type}",
  "set.acc.name_empty": "Tyhjänä näkyy {name}.",
  "set.acc.account_name": "Tilin nimi",
  "set.acc.accounts_appear_here": "Tilit tulevat tähän, kun yhdistät pankin tai tuot tiliotteen tiedostosta.",
  "set.acc.try_sample_data": "Kokeile esimerkkitiedoilla.",
} as const;
