# Contributing

## Issues

Issues are welcome for a bug or a figure that looks wrong. Say which version you run
(`docker compose exec banking node dist/node.js version`), what you did and what you expected. Leave out real bank
data: a few rows with made-up amounts and merchant names are enough. Install and update problems are often in
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Pull requests

- Everything in a pull request is public: commits and their author address, branch name, title, body and check logs.
  The `privacy` check refuses real personal data, secrets, machine names, home paths, pictures that `pnpm shots` did
  not take and commits whose author address is not GitHub's no-reply address (CLAUDE.md, "The public repository").
- Set up as [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) says and run `pnpm check`. CI also runs on the pull request; a
  first contribution waits for the maintainer to approve the run.
- A bug fix starts with a test that fails without it. [CLAUDE.md](CLAUDE.md) lists the invariants and conventions, and
  `tools/repo-rules` checks many of them.
- A change a user or an installer would notice adds a fragment in `changelog.d/`
  ([changelog.d/README.md](changelog.d/README.md)). Do not edit `CHANGELOG.md` or the version numbers.
- A schema change is a new migration ([docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#database-change)).

## Security problems

Report a vulnerability privately as [SECURITY.md](SECURITY.md) says, not in an issue or a pull request.
