# Contracts of 1.5.1

Frozen when 1.5.1 ships. Until then a later task may update these files (see `../README.md`). While 1.5.1 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 1.5.0 the schema, the helper output and the `ops-*.json` files do not change, so `schema.sql` and the three
`ops-*.json` files are copies of 1.5.0's. `module-host.json` freezes the keys and export names of the shared files an
add-on module imports, including `components/Why`, which 1.5.1 restores.
