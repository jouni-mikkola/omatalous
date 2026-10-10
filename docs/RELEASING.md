# Releasing

Development happens in the private repository. Households get the app from the public repository
`jouni-mikkola/omatalous`, which holds one commit per published snapshot. `scripts/publish-public.sh` exports the
committed tree of `HEAD` there and pushes `main`. With `--tag` it also pushes `vX.Y.Z`. The public repository's release
workflow builds the image for amd64 and arm64, pushes it to `ghcr.io/jouni-mikkola/omatalous`, signs it with cosign
through GitHub OIDC and verifies the signature. The return page workflow publishes `relay/` to GitHub Pages on the same
tags and on every push to `main` that changes `relay/`. Nothing is pushed to `ghcr.io` before the owner approves the
`release` environment.

The release and return page workflows run only in the public repository. The upgrade rehearsal runs only in the private
one, because its baselines are private commits. CI runs in both. The script leaves out `.claude/`, the upgrade workflow
and `.github/upgrade-from.txt`.

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
   baseline.
7. Merge to `main` in the private repository and rename the `Unreleased` heading to the version. Run
   `scripts/publish-public.sh --tag` from a clean tree, with the owner's go-ahead. It checks that `version.ts`, the
   three `package.json` files and the top `CHANGELOG.md` heading agree, then publishes the snapshot and the tag. The
   workflow checks again that the tag equals `v` plus the app version. Use `scripts/publish-public.sh` without
   `--tag` for a snapshot that is not a release.
8. Approve the `release` environment in the public repository. When it finishes, press *Tarkista päivitykset* on a test install, then *Päivitä*.
9. `TALOUS_CHANNEL=source` keeps an install on the source build. An install made from the `90dc8f3` baseline updates once
   with `git pull && docker compose up -d --build`.

## One-time GitHub setup (owner)

This applies to the public repository. The private one only needs CI and the upgrade rehearsal.

- [ ] Two-factor authentication with a hardware key, recovery codes stored offline, no SMS. Review authorised apps and
  personal tokens. This account is the root of trust for every install.
- [ ] Publish the first snapshot with `scripts/publish-public.sh`. It creates `main`, the default branch, and the
  release workflow only accepts a tag on a commit that is on `main`.
- [ ] Ruleset for `main`: force pushes and deletion blocked, linear history. Only the owner pushes, from the script, so
  no pull request is required there. In the private repository, protect its `main` with the checks `test`, `e2e`,
  `docker` and `Upgrade / upgrade`.
- [ ] Ruleset for tags `v*`: only the owner creates them, no updates, no deletion.
- [ ] Secret scanning with push protection, Dependabot alerts and security updates.
- [ ] Private vulnerability reporting, which the root [SECURITY.md](../SECURITY.md) points to.
- [ ] Actions: only GitHub's and the named actions, approval for workflows from outside collaborators, read-only token by
  default. Allow Actions to write packages.
- [ ] Environment `release` with the owner as required reviewer.
- [ ] Settings > Pages: serve the `gh-pages` branch, for the return page. The first snapshot push to `main` publishes it.
- [ ] After the first push, make the `ghcr.io` package public and link it to the repository.
- [ ] Choose a licence and add `LICENSE` in the private repository, so it ships with the snapshot. Without one nobody else
  may reuse the code.
