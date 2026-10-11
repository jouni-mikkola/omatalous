# Releasing

Development happens in the private repository. Households get the app from the public repository
`jouni-mikkola/omatalous`, which holds one commit per published snapshot. A publish exports the committed tree of
`HEAD` there and pushes `main`, and can push the tag `vX.Y.Z` with it. The public repository's release
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
and `upgrade-ok`, so a check has one stable name while jobs and baselines change. A snapshot leaves out what only the private repository
uses: its plans, process notes and maintainer tools, the release scripts, the upgrade and branch workflows, the upgrade
baselines and the Dependabot settings. Dependency updates happen in the private repository. A commit merged in the
public one is not refused: the next snapshot replaces the tree and silently undoes it, unless the commit was replayed in
the private repository first ([CONTRIBUTING.md](../CONTRIBUTING.md)).

Snapshots are signed when git is set to sign commits. The release channel does not need that, it checks the image
signature. An install with `ops/allowed_signers` does, so sign them before such an install updates.

## When CI runs

The private repository pays for its Actions minutes (2,000 a month), so a push there runs nothing. `ci.yml` skips every
job, `ci-ok` included, when the event is a push and the repository is the private one. The public repository runs CI on
every push, which is free.

| Workflow | Private repository | Public repository |
|---|---|---|
| `ci.yml` (about 9 billed minutes) | a pull request, or `workflow_dispatch` (a release starts it for the release commit and the baseline commit) | every push and pull request, and by hand |

A push to the private repository leaves a skipped `ci-ok` on its commit. `tools/ci/wait.sh` ignores skipped check runs,
so only a run that did the work answers for a commit. The concurrency group of `ci.yml` names the event, so that skipped
run never cancels a dispatched one.

## One-time GitHub setup (owner)

This applies to the public repository. The private one only needs CI and the upgrade rehearsal.

- [ ] Two-factor authentication with a hardware key, recovery codes stored offline, no SMS. Review authorised apps and
  personal tokens. This account is the root of trust for every install.
- [ ] Publish the first snapshot. It creates `main`, the default branch, and the
  release workflow only accepts a tag on a commit that is on `main`.
- [ ] Optional hardening, for when someone else gets write access: a ruleset for `main` that blocks force pushes and
  deletion and requires linear history. Only the owner pushes, from the script, so no pull request is required there.
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
