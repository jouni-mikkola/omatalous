/**
 * The catalogue of the shell: the header, the menus, the notices above every page, sign-in and setup. Same shape as the
 * tables of `messages.ts` (a Finnish table gives the codes, the English one must have the same codes and holes) and the
 * same test. The pages come in the same way, one file per area, as the work of English beside Finnish moves on.
 * Decision: a member who chose English reads the frame of the app in English. The sign-in and setup texts are here too, but
 * those screens come before the app knows who is signing in, so they stay Finnish until the choice is remembered on the device.
 */
export const FI_SHELL = {
  // the pages
  // the four tabs name the question; a page keeps its own name in its title until its view lands
  "nav.now": "Nyt",
  "nav.coming": "Tulossa",
  "nav.transactions": "Tapahtumat",
  "nav.reports": "Raportit",
  "nav.review": "Tarkistettavat",
  "nav.settings": "Asetukset",
  "nav.review_open": "avoinna",
  // the header
  "shell.skip": "Siirry sisältöön",
  "shell.main_menu": "Päävalikko",
  "shell.scope": "Näkymä",
  "shell.scope_own": "Oma",
  "shell.today": "Tänään {date}",
  "shell.scope_household": "Koko talous",
  "shell.user_menu": "Käyttäjävalikko",
  "shell.role_admin": "ylläpitäjä",
  "shell.role_member": "jäsen",
  "shell.sign_out": "Kirjaudu ulos",
  "shell.sign_out_failed": "Uloskirjautuminen ei onnistunut. Yritä uudelleen.",
  "shell.period": "Aikaväli",
  "foot.source": "Lähdekoodi",
  "foot.guides": "Ohjeet",
  "foot.support": "Tue kehitystä",
  // the notices
  "shell.offline_kept": "Ei yhteyttä palvelimeen. Näkyvät luvut ovat ajalta {time}.",
  "shell.fetch_again": "Hae uudelleen",
  "shell.offline_old": "Ei yhteyttä palvelimeen. Tiedot voivat olla vanhoja.",
  "shell.new_version": "Uusi versio {version} on valmis.",
  "shell.reload": "Lataa sivu uudelleen",
  "shell.rows_arrived_one": "{count} uusi tapahtuma",
  "shell.rows_arrived_many": "{count} uutta tapahtumaa",
  "shell.show": "Näytä",
  "shell.open_control_panel": "Avaa Control Panel",
  "shell.reconnect": "Yhdistä uudelleen",
  // loading and failing
  "load.loading": "Ladataan…",
  "load.slow": "Lataus kestää tavallista kauemmin. Odota tai lataa sivu uudelleen.",
  "load.failed": "Emme saaneet tietoja haettua. Yritä uudelleen.",
  "load.retry": "Yritä uudelleen",
  "more.show_n": "Näytä {count} lisää",
  "more.show_less": "Näytä vähemmän",
  // sign-in
  "login.title": "Kirjaudu sisään",
  "login.code_intro": "Anna koodi 5 minuutin kuluessa.",
  "login.recovery_code": "Palautuskoodi",
  "login.app_code": "Koodi sovelluksesta",
  "login.busy": "Kirjaudutaan…",
  "login.use_app_code": "Käytä sovelluksen koodia",
  "login.use_recovery_code": "Käytä palautuskoodia",
  "login.username": "Käyttäjätunnus",
  "login.password": "Salasana",
  "form.cancel": "Peruuta",
  // first-run setup
  "setup.title": "Ota sovellus käyttöön",
  "setup.intro": "Luo ylläpitäjän tunnus. Asennuskoodi näkyy asennuksen lopussa.",
  "setup.code": "Asennuskoodi",
  "setup.name": "Nimi",
  "setup.password": "Salasana (vähintään 12 merkkiä)",
  "setup.confirm": "Salasana uudelleen",
  "setup.busy": "Luodaan…",
  "setup.submit": "Luo ja kirjaudu",
  "setup.need_code": "Anna asennuskoodi.",
  "setup.need_name": "Anna nimi.",
  "setup.mismatch": "Salasanat eivät täsmää.",
  // password change
  "pwchange.title": "Vaihda salasana",
  "pwchange.intro": "Vaihda väliaikainen salasana omaksi.",
  "pwchange.current": "Nykyinen salasana",
  "pwchange.new": "Uusi salasana (vähintään 12 merkkiä)",
  "pwchange.new_again": "Uusi salasana uudelleen",
  "pw.level_1": "Heikko, mutta käy",
  "pw.level_2": "Kohtalainen",
  "pw.level_3": "Hyvä",
  "pw.level_4": "Vahva",
} as const;
