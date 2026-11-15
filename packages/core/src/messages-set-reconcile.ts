/**
 * The catalogue of Asetukset: reconcile.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_RECONCILE = {
  "set.rec.only_the_available_balance": "vain käytettävissä oleva saldo",
  "set.rec.the_bank_has_not_given": "pankki ei ole kertonut saldoa tältä päivältä",
  "set.rec.the_type_changed": "saldon tyyppi vaihtui",
  "set.rec.too_few_balances": "saldoja on liian vähän",
  "set.rec.the_transactions_start_later": "tapahtumat alkavat myöhemmin",
  "set.rec.some_of_the_transactions_are": "osa tapahtumista on muussa valuutassa",
  "set.rec.there_are_too_few_balances": "pankin saldotietoja on vielä liian vähän",
  "set.rec.the_bank_gives_only_the": "pankki kertoo vain käytettävissä olevan saldon",
  "set.rec.the_type_of_the_balance": "saldon tyyppi vaihtui",
  "set.rec.matches": "täsmää",
  "set.rec.does_not_match": "ei täsmää",
  "set.rec.matches_the_bank_s_balance": "Täsmää pankin saldoon",
  "set.rec.does_not_match_the_bank": "Ei täsmää pankin saldoon",
  "set.rec.there_is_not_enough_data": "tietoja ei vielä riitä",
  "set.rec.day_one": "{count} päivä",
  "set.rec.day_many": "{count} päivää",
  "set.rec.difference": "ero {amount}",
} as const;
