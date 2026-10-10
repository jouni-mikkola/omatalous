# Changelog fragments

A task that changes what a user, an installer or a developer sees adds one file here, `changelog.d/<task>.md`, in the
same commit as the change. Nobody edits `CHANGELOG.md` by hand. At release, `node tools/release/prepare.mjs X.Y.Z`
([docs/RELEASING.md](../docs/RELEASING.md)) merges the fragments into the `## X.Y.Z` section and deletes them. This
file stays.

## Format

```
section: Reliability
- A full disk shows a Finnish message instead of a generic error.
- Each entry is one line. An indented line continues the entry above it.
upgrade: Migration 0009 runs on the first start, after the usual copy.
```

- `section:` comes first and names where the entries go: Money and reports, Fetching and importing, Look, Reliability,
  Maintenance or For developers. That is also their order in `CHANGELOG.md`. A fragment has one section.
- Every other line is an entry. A leading `- ` is optional. Write what changes for the reader, in English, plain and short
  (the writing rules in `CLAUDE.md` apply). Name commands and menus the way the docs do.
- `upgrade: <line>` goes to the Upgrade list of the release, whatever the section. Use it for anything an installer
  must know: a migration, a changed default, a new `.env` key, something that stops working. The release script
  refuses a release that adds a migration and has no `upgrade:` line.
- Fragments are merged in file name order, so entries of one section follow the order of the file names.

A fragment that only repeats the commit message is noise. A change nobody outside the code would notice needs none.
