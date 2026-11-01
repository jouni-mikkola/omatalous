/**
 * The catalogue of Asetukset: status.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_STATUS = {
  "set.status.not_yet": "ei vielä",
  "set.status.disk": "Levy",
  "set.status.enough": "riittää",
  "set.status.low": "niukalla",
  "set.status.full": "lopussa",
  "set.status.unknown": "ei tietoa",
  "set.status.remote_access": "Etäkäyttö",
} as const;
