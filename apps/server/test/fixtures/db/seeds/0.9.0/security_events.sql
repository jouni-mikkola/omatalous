-- Security events of 0.9.0, four made-up ones, one of each kind the release adds: ops_watchdog (the host helper took an
-- update back; no user, no address) with its watchdog_notice for the admin (unread, notify), db_restored (the database
-- was put back from a copy at start; the admin's notice, unread) and data_reset (the admin emptied the data in the
-- browser: with the address and browser, the copy the reset saved and what became of the bank consents). The ids follow
-- the nine of 0.8.7.
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (10,'2026-10-09T09:40:00.000Z',NULL,'ops_watchdog',NULL,NULL,'päivitys: Edellinen versio palautettiin, koska sovellus ei vastannut 10 minuuttiin. Versiosta 0.9.0 palattiin versioon 0.8.7',0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (11,'2026-10-09T09:40:00.000Z','u-aino','watchdog_notice',NULL,NULL,'Edellinen versio palautettiin, koska sovellus ei vastannut 10 minuuttiin. Versiosta 0.9.0 palattiin versioon 0.8.7',1,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (12,'2026-10-10T03:20:00.000Z','u-aino','db_restored',NULL,NULL,'Tietokanta oli vaurioitunut. Se palautettiin varmuuskopiosta auto-20261010T030000.db (10.10. klo 03.00)',1,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (13,'2026-10-10T10:00:00.000Z','u-aino','data_reset','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0','varmuuskopio pre-reset-20261010T100000.db, pankkiyhteyksiä lopetettu 1, lopettamatta jäi 0',0,NULL);
