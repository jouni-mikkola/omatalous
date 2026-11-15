-- migrate: compat 0.64.0
-- Which views (report sections, insights, Optimoi findings) a member has opened, for the list of unopened views in
-- Asetukset > Palvelin (docs/ROADMAP.md, Later 11). Only the day is kept, once per view and member: no time, no count, no
-- route. Nothing leaves the install. Only adds a table, which older code neither reads nor writes.
-- view: `report:<section id>`, `insight:<source>` or `finding:<area>:<kind>`; the route checks the form.
CREATE TABLE view_opens (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view      TEXT NOT NULL,
  first_day TEXT NOT NULL,
  last_day  TEXT NOT NULL,
  PRIMARY KEY (user_id, view)
);
