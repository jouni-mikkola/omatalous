/**
 * The catalogue of Asetukset: rv.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_RV = {
  "set.rv.this_batch_of_questions_is": "Kävit tämän erän läpi",
  "set.rv.the_rest_are_waiting": "Ohitit loput",
  "set.rv.nothing_to_review_yet": "Ei vielä tarkistettavaa",
  "set.rv.questions_appear_here_once_a": "Kysymykset tulevat tänne, kun olet yhdistänyt pankin ja olemme hakeneet tapahtumat. Kysymme vain sitä, mitä emme osaa päätellä itse.",
  "set.rv.nothing_to_ask": "Ei kysyttävää",
  "set.rv.new_questions_come_when_the": "Saat uusia kysymyksiä, kun pankista tulee tapahtumia, joita emme osaa tulkita.",
  "set.rv.go_to_summary": "Yhteenvetoon",
  "set.rv.latest_transactions_name": "Viimeisimmät tapahtumat: {name}",
  "set.rv.the_answer_also_covers_earlier": "Vastaus koskee myös aiempia kuukausia, mutta ei maksuja, jotka poikkeavat selvästi tavallisesta.",
  "set.rv.do_not_ask_about_this": "Älä kysy tästä enää",
  "set.rv.skip_ask_later": "Ohita",
  "set.rv.newest_of": "{shown} uusinta {total} tapahtumasta",
  "set.rv.connect_bank": "Yhdistä pankki",
  "set.rv.hide_rows": "Piilota tapahtumat: {name}",
  "set.rv.show_rows": "Näytä tapahtumat: {name}",
  "set.rv.place": "Kysymys {position} / {of}",
} as const;
