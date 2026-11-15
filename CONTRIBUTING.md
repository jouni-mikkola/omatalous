# Contributing

Omatalous is developed in this repository. An add-on module that a household may load ([docs/MODULES.md](docs/MODULES.md)) is
kept apart and is not part of it.

## Issues

Issues are welcome for a bug or a figure that looks wrong. Say which version you run
(`docker compose exec banking node dist/node.js version`), what you did and what you expected. Leave out real bank
data. A few rows with made-up amounts and merchant names that show the same thing are enough. The usual install and
update problems are in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Pull requests

Pull requests are welcome too, and an accepted one is merged here.

Before you open one:

- Everything in it is public: the commits and their author address, the branch name, the title, the body and the
  logs of its checks. The `privacy` check refuses real personal data, secrets, machine names and home paths, and
  pictures `pnpm shots` did not take (CLAUDE.md, "The public repository").
- Set up as [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) says and run `pnpm check`. CI runs on the pull request too; a
  first contribution waits until the maintainer approves the run.
- A bug fix starts with a test that fails without it. The invariants and conventions in [CLAUDE.md](CLAUDE.md) apply,
  and `tools/repo-rules` checks many of them.
- A change a user or an installer would notice adds a fragment in `changelog.d/`
  ([changelog.d/README.md](changelog.d/README.md)). Do not edit `CHANGELOG.md` or the version numbers.
- A schema change is a new migration ([docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#database-change)).

## Security problems

Do not open an issue or a pull request for a vulnerability. Report it privately as [SECURITY.md](SECURITY.md) says:
the repository's Security tab, *Report a vulnerability*.
