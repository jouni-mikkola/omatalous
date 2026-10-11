# Releasing

Development happens in the private repository. Households get the app from the public repository
`jouni-mikkola/omatalous`, which holds one commit per published snapshot. `tools/publish-public.sh` exports the
committed tree of `HEAD` there and pushes `main`. With `--tag` it also pushes `vX.Y.Z`. The public repository's release
workflow builds the image for amd64 and arm64, pushes it to `ghcr.io/jouni-mikkola/omatalous`, signs it with cosign
through GitHub OIDC and verifies the signature with the function installs run (`scripts/lib/release.sh`). The return page
workflow publishes `relay/` to GitHub Pages on the same tags and on every push to `main` that changes `relay/`. The
release workflow has no approval step. It runs when a push to `main` brings a version that has no tag yet, when a tag
is pushed, or by hand with *Run workflow* on `main`. On `main` it creates the tag on that commit itself. A push of a
version that is released already does nothing.

Installs before 0.5.1 accept only a signature from a run started by a push. 0.4.0 and 0.5.0 were released by hand, so
those installs could not update to them. Release from a push (a new version on `main`, or a tag) while installs before
0.5.1 are supported. A run started by hand stops unless its `signed_by_hand` box is ticked, because only 0.5.1 and later
accept its signature. Retry a failed release with *Re-run failed jobs*, which keeps the push. Installs made from the
public repository before 0.4.0 accept only a tag (`refs/tags/v…`), so a release from `main` needs one manual update
there (CHANGELOG 0.5.1).

The release and return page workflows run only in the public repository. The upgrade rehearsal runs only in the private
one, because its baselines are private commits. CI runs in both. CI and the rehearsal each end in one summary job, `ci-ok`
and `upgrade-ok`, so a check has one stable name while jobs and baselines change. The script leaves out what only the private repository uses: `.claude/`, the upgrade and branch workflows,
`.github/upgrade-from.txt`, `.github/dependabot.yml`, itself and `ship.sh`. Dependency updates happen in the private repository. A commit
merged in the public one makes the next snapshot refuse to push.

Snapshots are signed when git is set to sign commits. The release channel does not need that, it checks the image
signature. An install with `ops/allowed_signers` does, so sign them before such an install updates.

## Release checklist

1. The work for the release is merged on the branch you release from. Each task left a fragment in `changelog.d/`
   ([changelog.d/README.md](../changelog.d/README.md)). Check that a change an installer must know about has an
   `upgrade:` line: new migrations, changed defaults, new `.env` keys, something that stops working.
   Land a worker branch with `tools/lead/land.sh <branch> --lane <glob>...`. It picks the commits on a detached HEAD
   and refuses a conflict (the worker rebases and resolves), a file outside the lanes and a result that removes lines
   the current branch added since the worker started (`--allow-removed` after you read them). It runs check, build
   and e2e as they apply, and only then moves the branch and removes the worker's worktree. It never pushes.
2. A schema change is a new file in `apps/server/migrations/`, additive, never an edit of an applied one. It also needs a
   frozen database fixture. Write INSERT statements for each table the release adds in
   `apps/server/test/fixtures/db/seeds/<version>/<table>.sql` (a leading comment says what the rows cover). Regenerate
   the contract, `contracts/<version>/schema.sql` ([contracts/README.md](../contracts/README.md)), then run
   `pnpm release:fixture <version>`. It migrates the previous fixture with the current code, adds the seed rows and
   writes `<version>.sql`. It refuses a new table without rows, a schema that differs from the contract, a pending
   migration and a file that does not load back to the same rows. Complete the header it prints.
3. Pick the version and run `node tools/release/prepare.mjs X.Y.Z` (`pnpm release:prepare X.Y.Z`, `--dry-run` only prints
   the section). It bumps `apps/server/src/version.ts` and the three `package.json` files, writes the `## X.Y.Z` section
   of `CHANGELOG.md` from the fragments and removes them. It refuses a version that is not above the newest `v*` tag
   and the current version, an Unreleased heading, and a release with new migration files and no `upgrade:` line. The
   private repository has no tags, so the last release is the newest commit in `.github/upgrade-from.txt` (`--since REF`
   names another). Read the diff and commit it as `Release X.Y.Z`.
4. Push the commit as the branch `release/X.Y.Z`. CI and the upgrade rehearsal start by themselves and run side by side.
   `ci-ok` and `upgrade-ok` must both be green. The rehearsal updates every baseline, and it checks that each baseline's
   maintenance helper accepts the new `docker-compose.yml`, because installs update from the browser through the helper
   they already run (`tools/ci/compose-compat.sh`). `pnpm e2e` is part of CI. `tools/ci/wait.sh <sha> ci-ok upgrade-ok`
   waits for both (exit 0 green, 1 a check failed, 2 CI cannot be read or the time ran out).
5. Run `tools/release/ship.sh` from a clean tree on that commit. It reads `ci-ok` and `upgrade-ok` itself with
   `wait.sh` and stops on a red or unreadable CI. `--ci-checked` says you read both another way, where `gh` cannot
   sign in. `--dry-run` runs the checks, reads no CI and pushes nothing. It checks that the versions and the top
   `CHANGELOG.md` heading agree, moves the private `main` to `HEAD` only forward (`git push origin HEAD:main`), runs
   `tools/publish-public.sh` and prints the release run to watch and the line for step 7.
6. The push of the new version to the public `main` starts the release workflow. It checks that `version.ts`, the three
   `package.json` files and the top `CHANGELOG.md` heading agree, builds, signs and creates the tag and the release on
   that commit. A snapshot that keeps the released version publishes nothing. `publish-public.sh` runs the version and
   CHANGELOG checks itself whenever the version has no public tag. Its `--tag` option pushes `main` and the tag in one
   atomic push from your machine and puts the annotated tag on the private `HEAD`. The run for `main` then finds the
   tag and leaves the release to the tag's run. `ship.sh` does not use it.
7. After the release, add the private commit it was published from to `.github/upgrade-from.txt` and keep the oldest
   supported one. The floor is `90dc8f3` (`0.1.0`). Delete the `release/X.Y.Z` branch.
8. Wait for the release workflow in the public repository. When it finishes, run `tools/ci/verify-release.sh --pull X.Y.Z`
   (an anonymous pull token, a manifest for amd64 and arm64), press *Tarkista päivitykset* on a test install, then *Päivitä*.
9. `TALOUS_CHANNEL=source` keeps an install on the source build. An install made from the `90dc8f3` baseline updates once
   with `git pull && docker compose up -d --build`.

## One-time GitHub setup (owner)

This applies to the public repository. The private one only needs CI and the upgrade rehearsal.

- [ ] Two-factor authentication with a hardware key, recovery codes stored offline, no SMS. Review authorised apps and
  personal tokens. This account is the root of trust for every install.
- [ ] Publish the first snapshot with `tools/publish-public.sh`. It creates `main`, the default branch, and the
  release workflow only accepts a tag on a commit that is on `main`.
- [ ] Optional hardening, for when someone else gets write access: a ruleset for `main` that blocks force pushes and
  deletion and requires linear history. Only the owner pushes, from the script, so no pull request is required there. In the private repository, protect its `main` with the check `ci-ok`. The
  rehearsal runs on release branches, so read `upgrade-ok` there before `ship.sh`.
- [ ] Optional hardening: a ruleset for tags `v*` where only the owner creates them, with no updates and no deletion.
- [ ] Secret scanning with push protection and Dependabot alerts. Leave Dependabot security updates off there and fix
  alerts in the private repository, where version and security updates run.
- [ ] Private vulnerability reporting, which the root [SECURITY.md](../SECURITY.md) points to.
- [ ] Actions: only GitHub's and the named actions, approval for workflows from outside collaborators, read-only token by
  default. Allow Actions to write packages.
- [ ] Optional hardening: required reviewer on the `release` environment. GitHub creates the environment on the first run.
- [x] Settings > Pages: serve the `gh-pages` branch, for the return page. Done.
- [ ] After the first push, make the `ghcr.io` package public and link it to the repository.
- [x] Licence: MIT, in `LICENSE`.

## Moving an install from the private repository

Installs made before the public repository existed were cloned from the private one. Move one after the first public
release. Data, volumes, `.env` and the container name stay as they are.

```bash
cd ~/banking-app
git remote set-url origin https://github.com/jouni-mikkola/omatalous.git
git fetch origin --tags
git checkout -B main origin/main
./scripts/update.sh
./scripts/install.sh --ops-helper --ops-policy
```

The public history is a different line from the private one, so the checkout replaces the local branch. The last line
writes the maintenance helper's policy again for the new origin. Without it, updates from *Asetukset > Ylläpito* stop
with "Etäosoite on muuttunut". If `ops/allowed_signers` exists, the public commits must be signed with a key in it.

An install made before `0.1.0` (commit `90dc8f3`) has no update script. Install it again and import the transactions from
CSV. An install of exactly `90dc8f3` updates once with `git pull && docker compose up -d --build`, and later with
`update.sh`.
