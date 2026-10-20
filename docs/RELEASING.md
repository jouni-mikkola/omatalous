# Releasing

Development happens in the private repository. Households get the app from the public repository
`jouni-mikkola/omatalous`, which holds one commit per published snapshot. A publish exports the committed tree of
`HEAD` there and pushes `main`, and can push the tag `vX.Y.Z` with it. The public repository's release
workflow starts with `plan`, which reads the version and the tag and checks that `version.ts`, the three `package.json`
files and the top `CHANGELOG.md` heading agree. Then two jobs run side by side. `verify` checks that the commit is on
`main`, which only GitHub can say. `build` makes the
amd64 and the arm64 image, each on a runner of its own processor with no emulation, and pushes both to
`ghcr.io/jouni-mikkola/omatalous` by digest with no version tag. `smoke` pulls each by digest on its own runner and starts
it. Every other check (the types, the build, the tests, the migrations against every baseline) runs before the push, on the
maintainer's machine, on both trees (the release gate and proof below). Only when `verify`, both builds and both smoke tests
have passed does `publish` give one index of the two the
version tag, sign it with cosign through GitHub OIDC and verify the signature with the function installs run
(`scripts/lib/release.sh`). `release` writes the GitHub release, as a pre-release (see Promotion below). A failed check, build
or smoke test leaves no tag, no signature and no release. The return page
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

## The smoke test and the rehearsal

On each processor the smoke test (`tools/ci/smoke-image.sh IMAGE VERSION COMMIT`) proves that the image's labels match
the version and the commit, that a new install answers `/api/health` within 120 seconds and prints its version, and that
a database of 0.5.0 is accepted by `migrate-check`, starts, keeps its users and ends with every migration applied. CI's
Docker job runs the same script on every image it builds. By hand, on a machine with Docker: `docker build -t x .`, then
`tools/ci/smoke-image.sh x unknown unknown`.

A red run leaves untagged image digests in `ghcr.io/jouni-mikkola/omatalous` and nothing an install can see: no tag on an
image, no signature, no GitHub release. `publish` and `release` need `verify`, both builds and both smoke tests, and
the build, which runs beside `verify`, pushes by digest only. A fault of the runner or the network is repeated with
*Re-run failed jobs*, which keeps the push and the jobs that passed; a fault in the code is fixed in a new commit.

The images of a release can be built and smoke tested ahead, by a run of the release workflow on a branch
`candidate/X.Y.Z-...` that holds the exact commit `main` later moves to. That run signs nothing and gives the images no
tag. Until the promotion half lands, the run on `main` builds its own.

The rehearsal is Actions, Release, *Run workflow* on `main` with `dry_run` ticked. The jobs `plan`, `verify`
and `dry-run` run, the last on both runners beside `verify`: the images are built into each runner's own Docker
and smoke tested there, and nothing is pushed, signed or released. `build`, `smoke`, `publish` and `release` are skipped.
Use it after a change to the Dockerfile, the release workflow or the runner images, and before the first release with this
workflow. It does not rehearse the push by digest of `build`, the pull by digest of `smoke`, or `publish` (the index, the
platform check, the signature, the label check). Their first run is the release itself. A fault there leaves no tag,
because the tag is made in `publish` after `verify` and both smoke tests, but it costs a release attempt.

Every job runs on `ubuntu-24.04` or `ubuntu-24.04-arm`, and a repo rule refuses a `-latest` label. Moving to a newer image
is `RUNNERS` in `tools/repo-rules/runners.ts` and the `runs-on` lines together, then a rehearsal.

## Promotion, holding and pulling

Every release is created as a pre-release. GitHub's `/releases/latest`, which installs read, skips pre-releases, so an
install is offered a release only after it is promoted: at its next check or when *Päivitä* is pressed, never by itself.
An install with the switch *Tarjoa uudet versiot heti* on (*Asetukset > Tekniset asetukset > Ylläpito*; without the helper, `TALOUS_PRERELEASE=yes` in its `.env`) follows pre-releases too and is offered one at once.

`promote.yml` (Actions, Promote) runs every six hours and by hand, in the public repository only. It looks at the highest
version of all releases, drafts included. When that is a pre-release that is 48 hours old, above the release now marked
latest, and its image verifies with the check installs run, it promotes it. It promotes one release per run. A run with
nothing to do ends green and says why. A release whose signature is refused is left alone, with a warning on the run.

- Hold a release, so that nobody gets it: `gh release edit vX.Y.Z --draft -R jouni-mikkola/omatalous`. A draft is never
  promoted, and it holds every older pre-release too: while the highest version is a draft, nothing below it is promoted.
  A draft below the highest pre-release changes nothing. To free the older ones, pull the held release.
- Pull a release: `gh release delete vX.Y.Z --yes -R jouni-mikkola/omatalous`. The git tag stays, so the next release
  needs a new version.
- Promote early: `gh release edit vX.Y.Z --prerelease=false --latest -R jouni-mikkola/omatalous`, the line the workflow
  runs. `--latest` is needed because GitHub's own latest goes by creation date, not by version.
- After a long quiet spell look at the Actions tab. GitHub switches a scheduled workflow off after 60 days without
  activity in the repository. A release then stays a pre-release (nothing breaks, installs are just not offered it) until
  Promote is enabled again (Actions, Promote, Enable workflow) or the line above is run by hand.

GitHub lists a draft to no unauthenticated caller, so a held release is invisible to installs, and so is a pulled one.
Installs older than 0.9.0 are the exception: their own `update.sh`, run by hand, takes the newest git tag, which a
pre-release has from its first minute, and a hold or a pull does not remove a tag. Their hourly check and the *Päivitä*
button read `/releases/latest` and are safe. So promote a good release by hand once its checks are green, and ship the
fix at once when it is bad. An install that runs 0.9.0 or later follows the release GitHub marks as latest in every mode.

## When CI runs

The private repository pays for its Actions minutes (2,000 a month), so only a run started by hand (`workflow_dispatch`)
does any work there: `ci.yml` skips every job, `ci-ok` included, on a push or a pull request in the private repository. The public repository runs CI on
every push, which is free.

| Workflow | Private repository | Public repository |
|---|---|---|
| `ci.yml` (about 9 billed minutes, and about one more for the image smoke test) | `workflow_dispatch` only; a pull request skips every job (a release starts it only when it is asked for a clean runner; it runs the same checks on its own machine) | every push and pull request, and by hand |

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
- [x] Licence: AGPL-3.0-only with the attribution term of section 7(b) from 0.68.0, in `LICENSE` (0.66.0 is under the
  Omatalous Personal Use License 1.0, earlier releases are MIT).
