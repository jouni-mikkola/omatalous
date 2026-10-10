# Releasing

Development happens in the private repository. Households get the app from the public repository
`jouni-mikkola/omatalous`, which holds one commit per published snapshot. `tools/publish-public.sh` exports the
committed tree of `HEAD` there and pushes `main`. With `--tag` it also pushes `vX.Y.Z`. The public repository's release
workflow builds the image for amd64 and arm64, pushes it to `ghcr.io/jouni-mikkola/omatalous`, signs it with cosign
through GitHub OIDC and verifies the signature. The return page workflow publishes `relay/` to GitHub Pages on the same
tags and on every push to `main` that changes `relay/`. The release workflow has no approval step. It runs when the
owner pushes a tag, or by hand with *Run workflow* on `main`, which then creates the tag on that commit itself.

The release and return page workflows run only in the public repository. The upgrade rehearsal runs only in the private
one, because its baselines are private commits. CI runs in both. The script leaves out `.claude/`, the upgrade workflow,
`.github/upgrade-from.txt` and `.github/dependabot.yml`. Dependency updates happen in the private repository. A commit
merged in the public one makes the next snapshot refuse to push.

Snapshots are signed when git is set to sign commits. The release channel does not need that, it checks the image
signature. An install with `ops/allowed_signers` does, so sign them before such an install updates.

## Release checklist

1. Pick the version. Bump `apps/server/src/version.ts` and the three `package.json` files. A test checks they agree.
2. Write the `CHANGELOG.md` section. Add an Upgrade list when there are new migrations, changed defaults, new `.env` keys or
   something that stops working. The unreleased entries move under the new version heading.
3. A schema change is a new file in `apps/server/migrations/`, additive, never an edit of an applied one.
4. Add a frozen database fixture, `apps/server/test/fixtures/db/<version>.sql`.
5. Add the new tag to `.github/upgrade-from.txt` and keep the oldest supported one. The floor is `90dc8f3` (`0.1.0`).
6. `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm e2e` are green. The `Upgrade / upgrade` check is green for every
   baseline. It also checks that each baseline's maintenance helper accepts the new `docker-compose.yml`, because installs
   update from the browser through the helper they already run (`tools/ci/compose-compat.sh`).
7. Merge to `main` in the private repository and rename the `Unreleased` heading to the version. Run
   `tools/publish-public.sh --tag` from a clean tree. It checks that `version.ts`, the three `package.json` files and
   the top `CHANGELOG.md` heading agree and that the tag is free in both repositories, then publishes the snapshot and
   the tag. It also puts the annotated tag `vX.Y.Z` on the private `HEAD` and pushes it to the private origin, so
   `.github/upgrade-from.txt` can name it. The
   workflow checks again that the tag equals `v` plus the app version. Use `tools/publish-public.sh` without
   `--tag` for a snapshot that is not a release. Where pushing a tag is not possible, publish without `--tag` and run
   the Release workflow by hand on `main` in the public repository. It takes the version from the tree, refuses a
   version that already has a tag, and creates the tag and the release on the commit it built.
8. Wait for the release workflow in the public repository. When it finishes, press *Tarkista päivitykset* on a test install, then *Päivitä*.
9. `TALOUS_CHANNEL=source` keeps an install on the source build. An install made from the `90dc8f3` baseline updates once
   with `git pull && docker compose up -d --build`.

## One-time GitHub setup (owner)

This applies to the public repository. The private one only needs CI and the upgrade rehearsal.

- [ ] Two-factor authentication with a hardware key, recovery codes stored offline, no SMS. Review authorised apps and
  personal tokens. This account is the root of trust for every install.
- [ ] Publish the first snapshot with `tools/publish-public.sh`. It creates `main`, the default branch, and the
  release workflow only accepts a tag on a commit that is on `main`.
- [ ] Optional hardening, for when someone else gets write access: a ruleset for `main` that blocks force pushes and
  deletion and requires linear history. Only the owner pushes, from the script, so no pull request is required there. In the private repository, protect its `main` with the checks `test`, `e2e`,
  `docker` and `Upgrade / upgrade`.
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
