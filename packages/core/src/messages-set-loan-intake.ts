/**
 * The catalogue of Asetukset: loan intake.
 * Decision: the household reads the settings in its own language.
 * Same shape as the tables of `messages.ts`: the Finnish table gives the codes and the English one must have the same codes and holes.
 */
export const FI_SET_LOAN_INTAKE = {
  "set.ln.reading_the_pdf": "Luemme PDF-tiedostoa…",
  "set.ln.loading_the_image_reader_the": "Lataamme kuvanlukijaa. Ensimmäinen lataus on noin 11 megatavua.",
  "set.ln.reading_the_image": "Luemme kuvaa…",
  "set.ln.loan_read": "Luettu laina",
  "set.ln.no_loan_details_were_found": "Emme löytäneet kuvasta lainan tietoja. Kokeile tarkempaa kuvaa, liitä lainan tiedot tekstinä tai lisää laina käsin.",
  "set.ln.no_loan_details_were_found_2": "Emme löytäneet tekstistä lainan tietoja. Liitä lainasta kuvakaappaus tai lisää laina käsin.",
  "set.ln.the_file_is_too_large": "Tiedosto on liian suuri. Ota lainan tiedoista kuvakaappaus.",
  "set.ln.the_pdf_has_only_an": "PDF-tiedostossa on pelkkä kuva. Ota siitä kuvakaappaus ja liitä se.",
  "set.ln.the_file_is_not_an": "Tiedosto ei ole kuva, PDF eikä teksti.",
  "set.ln.the_file_could_not_be": "Emme voineet lukea tiedostoa. Yritä uudelleen tai liitä lainan tiedot tekstinä.",
  "set.ln.reading_was_cancelled": "Lukeminen keskeytyi.",
  "set.ln.paste_an_image_or_text": "Liitä kuva tai teksti lainasta",
  "set.ln.paste_a_screenshot_or_text": "Liitä tähän kuvakaappaus tai teksti, pudota kuva tai PDF, tai kirjoita lainan tiedot.",
  "set.ln.read_the_loan_details": "Lue lainan tiedot",
  "set.ln.choose_an_image_or_pdf": "Valitse kuva tai PDF",
  "set.ln.add_by_hand": "Lisää käsin",
  "set.ln.image_or_pdf_of_the": "Kuva tai PDF lainasta",
  "set.ln.the_image_and_text_are": "Luemme kuvan ja tekstin tässä selaimessa.",
  "set.ln.reading": "Lukeminen",
  "set.ln.stop": "Keskeytä",
  "set.ln.discard": "Hylkää",
  "set.ln.a_screenshot_of_the_positive": "Kuvakaappaus positiivisesta luottotietorekisteristä lisää kaikki lainat kerralla.",
  "set.ln.loan_n": "Laina {n}",
  "set.ln.found_one": "Löytyi {count} laina.",
  "set.ln.found_many": "Löytyi {count} lainaa.",
} as const;
