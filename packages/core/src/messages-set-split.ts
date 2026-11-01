/**
 * The catalogue of Asetukset: split.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_SPLIT = {
  "set.split.equally": "Tasan",
  "set.split.by_shares": "Osuuksien mukaan",
  "set.split.in_proportion_to_income": "Tulojen suhteessa",
  "set.split.fixed_amount": "Kiinteä summa",
  "set.split.the_split_of_the_rest": "Loppuosan jakoa ei ole kerrottu",
  "set.split.removed_member": "poistettu jäsen",
  "set.split.approve": "Hyväksy",
  "set.split.reject": "Hylkää",
  "set.split.cancel_the_proposal": "Peruuta ehdotus",
  "set.split.split_of_account_name": "Tilin {name} jako",
  "set.split.split": "Jako",
  "set.split.no_split_has_been_agreed": "Jakoa ei ole sovittu. Jaamme menot tilin käyttäjien osuuksien mukaan.",
  "set.split.earlier_splits": "Aiemmat jaot",
  "set.split.change_the_split": "Muuta jakoa",
  "set.split.choose_at_least_one_user": "Valitse vähintään yksi käyttäjä.",
  "set.split.enter_the_shares_as_whole": "Anna osuudet kokonaislukuina.",
  "set.split.choose_how_the_rest_is": "Valitse, miten loput jakautuvat.",
  "set.split.enter_the_amount_in_euros": "Anna summa euroina, esimerkiksi 300,00.",
  "set.split.change_the_split_of_account": "Muuta tilin {name} jakoa",
  "set.split.how_to_split": "Jakotapa",
  "set.split.the_rest_is_shared": "Loppuosan jako",
  "set.split.choose": "Valitse",
  "set.split.in_force_from": "Voimassa alkaen",
  "set.split.save": "Tallenna",
  "set.split.cancel": "Peruuta",
  "set.split.rest": "Loput: {kind}",
  "set.split.awaiting": "Odottaa hyväksyntää: {names}",
} as const;
