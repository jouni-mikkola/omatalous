/**
 * The catalogue of the list of unopened views (Asetukset > Palvelin). Same shape as the tables of `messages.ts` (a
 * Finnish table gives the codes, the English one must have the same codes and holes) and the same test.
 * Decision: the admin sees which reports, observations and tips nobody in the household opened for a quarter, in the
 * language they chose, and is told that the record stays on this install.
 */
export const FI_VIEWS = {
  "views.title": "Avaamattomat näkymät",
  "views.sub": "Raportit, havainnot ja vinkit, joita kukaan ei ole avannut {days} päivään. Avauspäivät pysyvät tässä asennuksessa. Emme lähetä niitä minnekään.",
  "views.caption": "Avaamattomat näkymät",
  "views.col_view": "Näkymä",
  "views.col_kind": "Laji",
  "views.col_last": "Viimeksi avattu",
  "views.kind_report": "Raportti",
  "views.kind_insight": "Havainto",
  "views.kind_finding": "Säästövinkki",
  "views.never": "ei kertaakaan seurannan aikana",
  "views.none": "Jokainen seurattu näkymä on avattu viimeisen {days} päivän aikana.",
  "views.young": "Aloimme seurata avauksia {date}. Lista ilmestyy, kun seurannasta on {days} päivää.",
  "views.not_started": "Aloitamme seurannan, kun avaat ensimmäisen näkymän.",
} as const;
