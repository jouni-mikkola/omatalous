/**
 * The catalogue of Asetukset: use ts.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_USE_TS = {
  "set.use.me": "Minä",
  "set.use.joint_account": "Yhteinen tili",
  "set.use.first_and_last": "{first} ja {last}",
  "set.use.balance_before_date": "Saldo ennen {date}",
  "set.use.shared": "Yhteistä",
  "set.use.do_not_know": "En tiedä",
  "set.use.person_percent": "{name} {percent} %",
} as const;
