# Security audit, October 2026

Date: 30 October 2026. Version 1.0 check, code and image.

Scope: sign-in, sessions, CSRF, passwords, rate limits, second factor (authenticator app and passkeys), service tokens,
Cloudflare Access, per-user isolation and role checks, export and import, sealed keys and secret rotation, copies
(local and to another machine), notices outside the browser, the host helper and its scripts (`install.sh`,
`update.sh`, `restore.sh`, `reset.sh`, `ops-helper.sh`, `scripts/lib`), remote access, the trade register and bank logo
calls, CSP and headers, the return page, the Dockerfile, `docker-compose.yml` and the workflows, and the dependencies
(`pnpm audit`, licences).

Method: two rounds, area by area, each by a reviewer that read the code and the invariants in `CLAUDE.md`. Round 1 was
one model, round 2 another, told what round 1 had fixed. Every finding below was read in the code; the ones marked
"checked" were also run. Findings in a private module are kept in the private notes, not here.

Result: no critical finding. Every major and minor finding below has a fix with a test, or a reason.

## Fixed

| # | Finding | Severity | Where | Fix |
|---|---|---|---|---|
| 1 | The password alone added or removed a passkey, though a second factor was on. A passkey added that way signs in later with no code | major | `services/passkeys.ts` | A code (app or recovery) is asked as well once a factor is on; both events notify the user. Test in `passkeys.test.ts`, `e2e/passkey.spec.ts` |
| 2 | An import used the role from when it started, so a demoted admin could still write household rows | major | `services/data-import.ts` | The role is read per request |
| 3 | Secret rotation: the app could seal with the old secret from the first step to the rename, and a rotation could be undone by a later save | major | `entry/secret-rotate.ts`, `services/context.ts` | The guard holds while `app_secret.next` exists; a refused rotation removes it. Test in `second-factor.test.ts` |
| 4 | Writes after a rotation sealed with the old secret | major | `services/context.ts` | Every seal checks the secret file |
| 5 | An encrypted copy could pair the database with a secret of another day | major | `scripts/backup.sh` | The secret is fingerprinted around the copy; no print while a rotation is under way |
| 6 | The compose policy of the helper did not see `env_file`: Compose folds it into `environment` and drops the key, so a commit could load a host file into the container (checked) | major | `scripts/lib/ops-git.sh` | The raw file is refused if it names `env_file`; an `environment` entry with no value is refused. Cases in `tools/test/ops-helper-source.test.sh` |
| 7 | A remote access change did not take the install lock | major | `scripts/ops-helper.sh`, `scripts/lib/ops-access.sh` | It takes the lock like an update |
| 8 | A service token could make the server write: the Optimoi snapshot and the freezing of closed settlement months | minor | `routes/optimise.ts`, `services/service-tokens.ts` | The snapshot is not stored for a token; the settlement route is shut to tokens. Test in `service-tokens.test.ts` |
| 9 | Concurrent removal of the authenticator app and the last passkey could leave a public admin with no factor | minor | `db/` factor repo | The delete checks the last factor in the same statement |
| 10 | Withdrawn Cloudflare Access signing keys stayed trusted | minor | `services/cloudflare-access.ts` | Keys are fetched again every hour |
| 11 | The helper deleted the installer's staging `.env.new` while an install ran | minor | `scripts/ops-helper.sh` | Only under the install lock |
| 12 | Local backup pruning ignored the three-copy rule | minor | `scripts/backup.sh` | Keeps the three newest intact copies |
| 13 | A parse error of a bank answer could put a fragment of the body in the log | minor | `connectors/enable-banking/client.ts` | Only the error name is logged |
| 14 | The bank return state was not single use under parallel requests | minor | `connectors/link-state.ts` | Taken in one statement |
| 15 | The secret check opened one sealed value only, so a database sealed under two secrets passed | minor | `services/secret-rotation.ts` | The first value of each kind is opened |
| 16 | Not all browser security events carried address and agent | trivial | `routes/auth.ts` | Added |
| 17 | The licence notice lacked the passkey library and its dependencies | minor | `THIRD_PARTY_NOTICES` | Regenerated; `tools/third-party-notices.mjs --check` passes |
| 18 | The typed user name was stored raw in security events, so a password typed in the wrong field stayed 90 days | trivial | `routes/auth.ts` | Stored only if it has the shape of a user name |
| 19 | The notice address check missed NAT64 and 6to4 prefixes | trivial | `services/outside-notices.ts` | Added |
| 20 | A key file for the copy to another machine could stay if the helper was killed | trivial | `scripts/lib/ops-offsite.sh` | Removed at the start of the action |
| 21 | The helper's permission check and the schedule's list did not cover `docker-compose.yml`, `Dockerfile`, `deploy/` | minor | `scripts/ops-helper.sh`, `scripts/lib/ops-schedule.sh` | Added to both |

## Recorded reason, no change

| Finding | Severity | Reason |
|---|---|---|
| Base image tag has no digest; the BuildKit frontend is unpinned (`Dockerfile`) | minor | The release image is signed and verified by digest, so installs on the release channel run what CI built. A digest needs a pull from the registry, which this audit did not do; Dependabot should keep one current. Open as a follow-up |
| Caddy has no `cap_drop` or read-only root (`docker-compose.yml`) | minor | The container is the internet-facing one, but the change cannot be tried without running it with real certificates; the app and tunnel containers are hardened. Follow-up |
| `TUNNEL_TOKEN` and `SETUP_CODE` are environment values | minor | Readable only with Docker access, which is root on the host. The setup code ends at the first admin |
| Sessions have no absolute lifetime; each use extends them | trivial | A stolen cookie is useful until the owner signs out or changes the password, which ends all sessions. Sign-out and the session list exist. Revisit with idle-timeout settings |
| Any `v*` tag on a commit of main republishes the return page | trivial | Needs write access to the repository; the install script hash in the docs makes an old script fail, not run |
| The import copies `custom_name` for new accounts | trivial | Restores the user's own name into an account that import creates; no other path writes it. The invariant wording is widened in `CLAUDE.md` |
| Balance history helpers have no `user_id` predicate (`db/finance/balance-record.ts`) | minor | The tables are household stores keyed by account key; every caller passes keys from the user's own account rows. Invariant tests cover the callers |
| Notice address: DNS may change between check and send | trivial | Known and written in `SECURITY.md`; only an admin sets the address and the answer is not read |
| The rotation guard in `secretbox.ts` is checked before an async write finishes | minor | Rotation is a CLI run the admin makes with the app stopped; the guard catches a running app's later writes, and the post-rotation check refuses a mixed database |
| The rotation check opens one sealed value per kind, not every value | trivial | A mixed database needs a rotation that failed midway; that run keeps the old file and removes `.next`, so the check is a second guard, not the only one |
| Backup pruning protects the three newest names without a per-file check (`scripts/backup.sh`) | trivial | A run that fails its own checks keeps nothing new; the `dbcopy.sh` rule of three newest intact copies stays the one for the app. Revisit with a verified listing |

## Held, no finding

- Login: attempts counted before the hash, uniform timing, Argon2id limits, hash upgrade race.
- Sessions and cookies: hashed tokens, `HttpOnly`, `SameSite=Lax`, all other sessions end on password change and reset.
- CSRF: header and origin on every state-changing request.
- Authenticator app and recovery codes: single use, constant time, one throttle.
- Service tokens: stored as a hash, member role, GET only, deny by default.
- Cloudflare Access: RS256 fixed, issuer, audience and time checked after the signature.
- Per-user isolation and role checks of the routes read; export and import limited to the user's rows.
- Sealed keys: each value under its own context; rotation collects every sealed place.
- Host helper: poll shape and action allowlist, no text from the database reaches a command; release signature checked
  by digest before any merge; release tags move forward only; `.env` writer; the offsite batch cannot be injected.
- Image: runs as `node`, final stage holds only the bundle, migrations, public files and licences; the app container is
  read-only with no capabilities; workflows pin actions by SHA and give each job its own permissions.
- Dependencies and licences: `pnpm audit` clean at the audit date; notice file matches the lockfile.

## Not covered

No image scan with trivy or grype was run. No test against real banks or a real
authenticator device (the passkey device test stays open in the roadmap). The running host was not inspected.
