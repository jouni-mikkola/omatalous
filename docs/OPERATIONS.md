# Operations

The things you need less often than [INSTALL.md](INSTALL.md): several instances, the `.env` keys, scripted installs,
the maintenance helper, backups and restores by hand, starting over and the command line. Run the commands in the
`banking-app` folder on the machine.

## Command line

| | |
|---|---|
| Check | `./scripts/doctor.sh` |
| Update | `./scripts/update.sh` |
| Back to the previous version | `./scripts/update.sh --rollback` |
| Backup into `backups/` | `./scripts/backup.sh` |
| Change how the app is reached | `./scripts/install.sh --reconfigure` |
| Logs | `docker compose logs -f banking` |
| Version | `docker compose exec banking node dist/node.js version` |
| New setup code, before the first user | `docker compose exec banking node dist/node.js setup-code` |
| Reset a password | `docker compose exec banking node dist/node.js user reset-password <user>` |
| Sign everyone out | `docker compose exec banking node dist/node.js sessions revoke-all` |
| New app secret | `docker compose exec banking node dist/node.js secret rotate`, then `docker compose restart banking` |
| Stop / start | `docker compose stop` / `docker compose up -d` |

`secret rotate` is the only supported way to change the app secret. It re-seals every saved bank key under the new
secret after a database copy (`pre-secret-rotate-*`) and keeps the old secret as `app_secret.prev-<time>` in the
secrets volume. Delete that file when the copies made before the rotation are gone (14 days).

## Scripted install

The installer asks nothing. Answers come as flags or environment variables.

| Flag | Variable | Meaning |
|---|---|---|
| `--yes` | | accepted, changes nothing |
| `--access lan\|local\|tunnel\|domain` | `TALOUS_ACCESS` | how the app is reached (default `lan`) |
| `--domain talous.oma.fi` | `TALOUS_DOMAIN` | for `domain` and `tunnel` |
| `--email you@oma.fi` | `TALOUS_EMAIL` | for `domain` (Let's Encrypt) |
| | `TALOUS_TUNNEL_TOKEN` | for `tunnel`; only a variable, so it stays out of `ps` |
| `--port 8080` | `TALOUS_PORT` | default: the first free port from 8080 |
| `--bind 192.168.1.10` | `TALOUS_BIND` | for `lan`: the address to listen on, default the default route's address |
| `--name isa` | `TALOUS_NAME` | instance name, default: the directory name |
| `--install-docker` | | install Docker if it is missing (apt based systems, needs root or sudo) |
| `--no-ops-helper` | `TALOUS_OPS_HELPER=0` | leave the maintenance helper out |
| `--ops-helper`, `--ops-helper-off` | | install or remove only the helper |
| `--ops-policy` | | write the helper's policy again from this clone's `origin` |
| `--reconfigure` | | show the access menu on an existing install |

The access menu lists 1 Kotiverkko, 2 Vain tämä kone, 3 Cloudflare Tunnel and 4 Oma domain.

```bash
./scripts/install.sh --access domain --domain talous.oma.fi --email me@oma.fi
TALOUS_TUNNEL_TOKEN=eyJ... ./scripts/install.sh --access tunnel --domain talous.oma.fi
```

A re-run keeps the existing `.env` unless `--reconfigure` or an answer flag is given. The last lines of the output hold
the address and the setup link.

## The maintenance helper

The helper is what lets *Asetukset > Palvelin > Ylläpito* update, roll back, back up, restart and check the install.
It is a script on the host (`scripts/ops-helper.sh`) that runs once a minute from a systemd user timer, or from cron when
the timer cannot be used. Each instance has its own (`talous-ops-<name>`, marked `# talous-ops:<name>` in cron).

- The app only writes a request row. The helper takes the oldest one, checks it against a fixed list and runs one of
  the project's own scripts. The six actions are check-update, update, rollback, backup, restart and doctor. None takes
  a parameter, and nothing from the database reaches a shell.
- Access and port changes are not done from the browser. Use `./scripts/install.sh --reconfigure`.
- The helper never runs as root and refuses to run if its files are writable by others.
- It keeps its state in `ops/` (policy, journal, run logs, `helper.log`, `RECOVERY.txt`). If an update and its
  rollback both fail, `ops/RECOVERY.txt` has the exact commands.
- A systemd user timer stops when you log out, unless lingering is on: `sudo loginctl enable-linger $(id -un)`. The
  installer says so when it falls back to cron.
- `./scripts/install.sh --ops-helper` installs it again, `--ops-helper-off` removes it. See
  [SECURITY.md](SECURITY.md#updates-and-the-maintenance-helper) for what it is trusted with.

## Updates

Once the project has a release (a tag `vX.Y.Z`), an install follows the releases. The signed image comes from
`ghcr.io`, its signature is checked against the project's release workflow, and the update then runs. Without a
release, or with `TALOUS_CHANNEL=source` in `.env`, the update builds the newest source on the machine.

An install made before `0.1.0` (commit `90dc8f3`) has no update script. Reinstall it. An install from the `90dc8f3`
baseline updates once with `git pull && docker compose up -d --build`.

`./scripts/update.sh --yes` is for cron: it goes back by itself if the new version does not start. The database copy
made before an update (`pre-update-*`) is deleted after 14 days unless it is the newest, so a rollback after a longer
wait restores only that newest copy.

## Backups

```bash
./scripts/backup.sh    # writes backups/talous-YYYYMMDD-HHMMSS.db.gz
```

Run it daily with `crontab -e`:

```cron
30 3 * * * cd $HOME/omatalous && ./scripts/backup.sh >> backups/backup.log 2>&1
```

It keeps 30 days. Copies on the host in `backups/` are outside the 14-day pruning of the app's own copies. To
encrypt, install `age` and set `BACKUP_AGE_RECIPIENT=age1...` on the cron line. With `age` the encryption key of the bank
keys (`app_secret`) is backed up too. Without it, save that key in your password manager:

```bash
docker compose exec banking cat /secrets/app_secret
```

Copy `backups/` to another device as well.

The app also makes its own copy every day, `/data/backups/auto-YYYY-MM-DD.db` in the data volume, and keeps the seven
newest. Copies older than 14 days are deleted, apart from the newest `pre-*` copy. They are plain database files. List
them with:

```bash
docker compose run --rm --no-deps -T --entrypoint ls banking /data/backups
```

### Restore by hand

Restore one of the app's copies (stop the app, copy the file over `banking.db`, start the app):

```bash
docker compose stop banking
docker compose run --rm --no-deps -T --entrypoint sh banking \
  -c 'cp /data/backups/auto-2026-10-09.db /data/restore.db && rm -f /data/banking.db-wal /data/banking.db-shm && mv /data/restore.db /data/banking.db'
docker compose start banking
```

Restore a file made by `backup.sh`:

```bash
docker compose stop banking
gunzip -c backups/talous-20261009-0330.db.gz | docker compose run --rm --no-deps -T --entrypoint sh banking \
  -c 'cat > /data/restore.db && rm -f /data/banking.db-wal /data/banking.db-shm && mv /data/restore.db /data/banking.db'
docker compose start banking
```

On a new machine the restored database cannot open its saved bank keys, because `app_secret` is not in it. Put the saved
`app_secret` into the `banking-secrets` volume before the first start, or set Enable Banking up again under
*Asetukset > Palvelin*. The transactions stay either way.

## Where your data lives

The database is in the Docker volume `banking-data`. `banking-secrets` holds the key that opens the bank keys in it.
Both survive restarts, updates and image rebuilds. Only `docker compose down -v` and `./scripts/reset.sh` delete them.

## Start over

```bash
./scripts/reset.sh
```

The script offers a backup first and asks you to type `POISTA` before it deletes anything. It removes the containers,
images, volumes and `.env`. `backups/` stays. Then install again with `./scripts/install.sh`.

## Several instances on one machine

Each instance is a clone of the repository in its own directory, with its own `.env`, containers, image, volumes, port,
`backups/` and update state. Updating or resetting one never touches another. To add one:

```bash
cd ~/omatalous
./scripts/install.sh --new-instance isa
```

This clones the repository to `~/isa` from the same origin and branch and runs the installer there with the name preset.
Only commits pushed to origin are included. If the install fails after the clone, the folder stays. Run
`~/isa/scripts/install.sh --name isa` again or delete the folder. The installer picks the first free port from 8080
and refuses a name or port that another instance or program already uses. The flags of the
[scripted install](#scripted-install) go along.

| Key in `.env` | Meaning |
|---|---|
| `INSTANCE_NAME` | container, image (`<name>:latest`, `<name>:previous`) and session cookie name |
| `COMPOSE_PROJECT_NAME` | prefix of the volumes, `<name>_banking-data` and `<name>_banking-secrets` |
| `HOST_PORT` | port on the host, default 8080 |
| `BIND_ADDRESS` | host address of that port, the home network address by default |
| `CADDY_ADDRESS` | host address for Caddy's ports 80 and 443, only when set (an IPv6 address in brackets) |
| `TALOUS_CHANNEL` | `release` or `source`, see [Updates](#updates) |
| `INDUSTRY_LOOKUP` | `false` turns the trade register lookup off by default |
| `TRUST_PROXY` | `true` behind Caddy or a tunnel, so the client address comes from the proxy |

An install made before these keys existed keeps its names whatever its directory is called: the container
`banking-app`, the image `banking-app:latest` and its current volumes. Do not change `COMPOSE_PROJECT_NAME` of a running
instance, because the volumes are named after it and a new name leaves the old volumes with the data behind. Changing
`INSTANCE_NAME` renames the container, the image and the session cookie, so everyone is signed out.

Instances share the machine's address and differ by port. One Caddy needs ports 80 and 443 on an address. A second
instance with Caddy needs another IP address of the machine, a Cloudflare Tunnel, or your own proxy in front of the
instance's port. A first Caddy without `CADDY_ADDRESS` holds 80 and 443 on all addresses. Add
`CADDY_ADDRESS=<its own IP>` to its `.env` and run `docker compose up -d` there before installing the second.
Each instance has its own Cloudflare tunnel and public hostname, `http://banking:8080` inside its own Compose network.

Backups, updates and resets run per instance, in its directory:

```bash
for d in ~/omatalous ~/isa; do (cd "$d" && ./scripts/update.sh); done
```

In cron, give each instance its own line with `cd` to its directory. `./scripts/reset.sh` removes only the instance of the
directory it runs in and names the volumes before it asks.

## Own computer

On a Linux desktop, let the installer install Docker Engine, or install it yourself
([Docker's guide](https://docs.docker.com/engine/install/)). Then run the three install commands from the README and
choose `--access local` to listen on `http://localhost:<port>` only.

## Moving an install from the private repository

Installs made before the public repository existed were cloned from the private one. Move one after the first public
release is out. Data, volumes, `.env` and the container name stay as they are.

```bash
cd ~/banking-app
git remote set-url origin https://github.com/jouni-mikkola/omatalous.git
git fetch origin --tags
git checkout -B main origin/main
./scripts/update.sh
```

The public history is a different line from the private one, so the first checkout replaces the local branch. After that
`update.sh` and the maintenance helper follow the public releases as usual. If `ops/allowed_signers` exists, the
snapshots must be signed with a key in it, or the helper refuses them.
