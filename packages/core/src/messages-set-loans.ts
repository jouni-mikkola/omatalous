/**
 * The catalogue of Asetukset: loans.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_LOANS = {
  "set.loans.edit_loan": "Muokkaa lainaa",
  "set.loans.cancel": "Peruuta",
  "set.loans.the_loan_can_no_longer": "Lainaa ei enää löydy.",
  "set.loans.loan_removed": "Laina poistettu.",
  "set.loans.loans": "Lainat",
  "set.loans.loan": "Laina",
  "set.loans.linked_to_account_name": "Liitetty tiliin {name}",
  "set.loans.lender": "Lainanantaja",
  "set.loans.remaining": "Jäljellä",
  "set.loans.rate": "Korko",
  "set.loans.payment": "Maksuerä",
  "set.loans.last_due_date": "Viimeinen eräpäivä",
  "set.loans.actions": "Toiminnot",
  "set.loans.edit_loan_name": "Muokkaa lainaa {name}",
  "set.loans.edit": "Muokkaa",
  "set.loans.remove_loan_name": "Poista laina {name}",
  "set.loans.remove": "Poista",
  "set.loans.no_loans": "Ei lainoja.",
  "set.loans.remove_name": "Poista {name}?",
  "set.loans.remove_loan": "Poista laina",
  "set.loans.the_loan_is_removed_from": "Laina poistuu luvuista. Tapahtumat pysyvät ennallaan.",
  "set.loans.plus_interest": " + korko",
  "set.loans.recorded": "kirjattu {date}",
} as const;
