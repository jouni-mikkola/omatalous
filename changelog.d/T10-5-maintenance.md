section: Maintenance
- Asetukset > Palvelin ei enää hae Tilastokeskuksen kuluttajahintaindeksiä.
- Komentorivillä voi listata istunnot ja kirjata yhden jäsenen ulos (`sessions list`, `sessions revoke`).
- Komentorivillä on ohje, ja ylimääräinen sana pysäyttää komennon.
- Tietokantatiedostot ovat vain omistajan luettavissa.
- Yksi epäonnistunut ylläpitotehtävä ei estä muita.
upgrade: SESSION_DAYS hyväksyy vain kokonaisluvun 1:stä 365:een. Muulla arvolla istunto kestää 30 päivää ja käynnistys kertoo syyn.
