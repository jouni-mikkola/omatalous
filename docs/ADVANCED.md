# Advanced

Each section starts with when you need it. Run the commands on the machine, in the Omatalous folder (`cd ~/omatalous`).

| When you want to | Section |
|---|---|
| Use the app on your phone away from home | [Away from home](#away-from-home) |
| Give your parents or another household an Omatalous of their own | [A second copy on the same machine](#a-second-copy-on-the-same-machine) |
| Back up to a NAS, restore a backup or move to a new machine | [Backups](#backups) |
| Delete everything and install again | [Start over](#start-over) |
| Try Omatalous on your own Linux desktop | [On your own computer](#on-your-own-computer) |
| Install from a script without any questions | [Scripted install](#scripted-install) |
| Use a key made by Enable Banking, or give a member their own Enable Banking app | [Enable Banking options](#enable-banking-options) |
| Fix the *Ylläpito* buttons when the helper is missing | [The maintenance helper](#the-maintenance-helper) |
| Look up a command or a setting | [Commands](#commands), [Settings in .env](#settings-in-env) |

## Away from home

You need this only to open Omatalous outside your home network. Try the options in this order.

| Option | Choose it when | You need |
|---|---|---|
| [VPN](#vpn) | Your router can run a VPN server, such as WireGuard. The app stays closed to the internet, so this is the safest. | A VPN on the router and on the phone |
| [Cloudflare Tunnel](#cloudflare-tunnel) | Your router has no VPN, or your internet has no public address. | A domain on Cloudflare |
| [Own domain](#own-domain) | Your internet has a public address and you want a normal https address without Cloudflare. The login page is then on the internet. | A domain, two forwarded ports |

Your internet has a public address when the internet address in your router's status page is the same one a site such
as `ifconfig.me` shows. 4G and 5G home internet usually has none.

### VPN

1. Turn on the VPN server in your router and add the phone, following the router's instructions.
2. Install the VPN app on the phone and connect.
3. Check it: turn Wi-Fi off on the phone and open the same address you use at home. Omatalous opens.

Nothing changes in Omatalous. Linking a bank works over the VPN too.

### Cloudflare Tunnel

1. In Cloudflare Zero Trust, open *Networks > Tunnels* and create a tunnel of the Cloudflared type. Copy its token. It
   starts with `eyJ`. Skip the connector install that Cloudflare offers, because Omatalous runs the connector itself.
2. Give the tunnel a public hostname, for example `talous.example.fi`. As the service, type `http://banking:8080`. That
   is the app's name inside Omatalous, and it is the same for every install.
3. In Zero Trust, add an Access application for the same hostname with a policy that lets in only your own email
   addresses. Then nobody else even sees the login page.
4. On the machine run:

   ```bash
   TALOUS_TUNNEL_TOKEN=eyJ... ./scripts/install.sh --access tunnel --domain talous.example.fi
   ```

   The installer also saves the new address in the app.
5. Open `https://talous.example.fi`. The redirect URL under *Asetukset > Palvelin* is now
   `https://talous.example.fi/api/connections/callback`. Add it to your app's Redirect URLs in the Enable Banking
   Control Panel.
6. Check it: turn Wi-Fi off on the phone and open `https://talous.example.fi`.

From now on the household uses the https address at home too. The old `http://` address stops working. Cloudflare sees
the traffic unencrypted on its way through.

### Own domain

1. Point a DNS record, for example `talous.example.fi`, to your public address. If that address changes now and then,
   use your router's dynamic DNS feature to keep the record current.
2. In the router, forward ports 80 and 443 to the machine.
3. On the machine run:

   ```bash
   ./scripts/install.sh --access domain --domain talous.example.fi --email you@example.fi
   ```

   Caddy gets a Let's Encrypt certificate by itself. Its notices go to the email address. The installer also saves the
   new address in the app.
4. Open `https://talous.example.fi` and add the redirect URL under *Asetukset > Palvelin*,
   `https://talous.example.fi/api/connections/callback`, to your app's Redirect URLs in the Enable Banking Control Panel.
5. Check it: turn Wi-Fi off on the phone and open `https://talous.example.fi`.

The old `http://` address stops working. Login is protected against guessing, see
[SECURITY.md](SECURITY.md#login).

## A second copy on the same machine

You need this when another household should have an Omatalous of their own on your machine, for example your parents,
or when you want a copy to test with.

| | People see |
|---|---|
| A member in your Omatalous (*Asetukset > Talouden jäsenet*) | their own accounts, and the accounts others share with them |
| A second copy | only their own copy, with its own users, data, backups and updates |

Make the copy with a name of small letters, digits, `-` and `_`:

```bash
cd ~/omatalous
./scripts/install.sh --new-instance isa
```

This creates the folder `~/isa` next to `~/omatalous`, installs the copy there and prints its own address and setup
link. The copy gets the next free port, for example `http://192.168.1.50:8081`. It worked when that address shows the
setup page and your own Omatalous still opens.

The copy needs its own Enable Banking app, because it makes its own key. The person whose accounts it reads registers it
as in [ENABLE_BANKING.md](ENABLE_BANKING.md).

Run the copy's commands in its own folder, for example `cd ~/isa && ./scripts/update.sh`. Its *Ylläpito* page updates
and backs up only that copy.

To use the copy away from home:

- A VPN to your home covers every copy.
- With Cloudflare, give the copy a tunnel and hostname of its own, and run the tunnel command of
  [Cloudflare Tunnel](#cloudflare-tunnel) in the copy's folder.
- With your own domain, only one copy can have ports 80 and 443 on an address. A second copy needs another IP address of
  the machine or a Cloudflare Tunnel. The installer asks for the address when 80 and 443 are taken.

How the copies are kept apart is in [Settings in .env](#settings-in-env).

## Backups

Omatalous copies its database once a day and keeps the seven newest copies on the machine. They help after a bad update
but not if the disk breaks. For most households it is enough to download *Lataa uusin* under *Asetukset > Ylläpito* now
and then. Set up the daily backup below when you want copies on a NAS without pressing anything.

### Daily backup to a NAS

1. Mount the NAS share on the machine, for example at `/mnt/nas`. Your NAS's guide shows how.
2. Make an encryption key and keep the key file somewhere else than the NAS, for example in your password manager:

   ```bash
   sudo apt install -y age
   age-keygen -o ~/omatalous-backup.key    # prints the public key, age1...
   ```

3. Add a line with `crontab -e`, with your own public key:

   ```cron
   30 3 * * * cd $HOME/omatalous && BACKUP_AGE_RECIPIENT=age1... ./scripts/backup.sh >> backups/backup.log 2>&1 && rsync -a backups/ /mnt/nas/omatalous/
   ```

4. Check it the next morning: `ls -l backups/` lists `talous-<time>.db.gz.age` and `talous-<time>.app_secret.age`, and
   the same files are on the NAS.

`backup.sh` keeps 30 days in `backups/`. The `.app_secret.age` file holds the key that opens the saved bank keys, so a
restore on a new machine keeps the bank connections. Without `BACKUP_AGE_RECIPIENT` the files are not encrypted and the
app secret is not backed up.

With several copies, add a line for each, with `cd` to the copy's folder and its own folder on the NAS.

### Restore a backup

You need this when the database is damaged or you want an earlier state back. It replaces all data with the backup.

`restore` checks the file first (size, integrity, this app's tables) and refuses a bad one without changing anything.
It saves the current database as `backups/pre-restore-<time>.db` in the data volume before it swaps.

From a file downloaded with *Lataa uusin*, after copying it to the machine (for example with `scp`):

```bash
docker compose stop banking
cat auto-2026-10-09.db | docker compose run --rm --no-deps -T --entrypoint sh banking -c 'cat > /data/restore.db'
docker compose run --rm --no-deps -T banking node --disable-warning=ExperimentalWarning dist/node.js restore /data/restore.db
docker compose start banking
```

From a file made by `backup.sh`, start the second line with `gunzip -c backups/talous-20261009-0330.db.gz |`, or for an
encrypted one `age -d -i ~/omatalous-backup.key backups/talous-20261009-0330.db.gz.age | gunzip -c |`.

From one of the app's own copies (`docker compose run --rm --no-deps -T --entrypoint ls banking /data/backups` lists them):

```bash
docker compose stop banking
docker compose run --rm --no-deps -T banking node --disable-warning=ExperimentalWarning dist/node.js restore backups/auto-2026-10-09.db
docker compose start banking
```

It worked when you can log in and the newest transactions are from the day of the backup.

An empty or table-less `banking.db` next to saved copies is never started as a new install. The log says so and names
the newest copy to restore.

### Move to a new machine

1. Install Omatalous on the new machine as [INSTALL.md](INSTALL.md) says, but do not create a user.
2. If you have the `.app_secret.age` file from the old machine, put the key back before the restore:

   ```bash
   docker compose stop banking
   age -d -i ~/omatalous-backup.key talous-20261009-0330.app_secret.age | docker compose run --rm --no-deps -T \
     --entrypoint sh banking -c 'cat > /secrets/app_secret'
   ```

3. Restore the backup as above.
4. Log in at the new address and fix *Sovelluksen osoite* under *Asetukset > Palvelin*, which still has the old
   machine's address.

Without the app secret your users, transactions and settings come back, but the saved bank keys stay locked. Set
Enable Banking up again under *Asetukset > Palvelin* as [ENABLE_BANKING.md](ENABLE_BANKING.md) says and connect the
accounts again.

## Start over

You need this when you want to delete the install and all its data, for example after testing.

```bash
./scripts/reset.sh
```

It offers a backup first and asks you to type `POISTA` before it deletes anything. It removes the containers, the image of this install,
the data, the app secret, the maintenance helper and `.env`. The `backups/` folder stays, but a backup made without
`age` can no longer open the bank keys. Install again with `./scripts/install.sh`. With several copies it removes only
the copy of the folder it runs in.

## On your own computer

You need this to try Omatalous on a Linux desktop that is not always on. Use the install lines of the
[README](../README.md) with one change in the last line:

```bash
./scripts/install.sh --access local
```

The app then opens only on that computer, at `http://localhost:8080`.

## Scripted install

You need this when a script installs Omatalous with nobody at the keyboard. Give the answers as flags or environment
variables. With `--yes` the installer never asks anything.

| Flag | Variable | Meaning |
|---|---|---|
| `--yes` | | never ask; Docker is then installed only with `--install-docker` |
| `--install-docker` | | install Docker without asking |
| `--access lan\|local\|tunnel\|domain` | `TALOUS_ACCESS` | how the app is reached. Default `lan` when the machine has a home network address, else `local` |
| `--bind 192.168.1.10` | `TALOUS_BIND` | for `lan`, the address to listen on |
| `--domain talous.example.fi` | `TALOUS_DOMAIN` | for `tunnel` and `domain` |
| `--email you@example.fi` | `TALOUS_EMAIL` | for `domain`, Let's Encrypt notices go there |
| | `TALOUS_TUNNEL_TOKEN` | for `tunnel`, only as a variable so it stays out of the process list |
| `--port 8080` | `TALOUS_PORT` | the port, default the first free one from 8080 |
| `--name isa` | `TALOUS_NAME` | the copy's name, default the folder name |
| `--no-ops-helper` | `TALOUS_OPS_HELPER=0` | leave the maintenance helper out |
| `--reconfigure` | | show the access menu again on an existing install |

A token alone means `tunnel`, and `--domain` with `--email` means `domain`. A run on an existing install keeps its
`.env` unless `--reconfigure` or an answer flag is given. The last lines of the output hold the address and the setup
link.

## Enable Banking options

The redirect URL to register depends on how the app is reached. *Asetukset > Palvelin* always shows the right one.

| The app is reached at | Redirect URL |
|---|---|
| A home network address (the default) | `https://jouni-mikkola.github.io/omatalous/callback/`, the project's return page. It sends the browser on to your own address, and only to private addresses. |
| Your own https address | `https://<address>/api/connections/callback` |
| An install made before the return page, until you press *Ota käyttöön* | `https://localhost/api/connections/callback`. The bank then shows an error page, and you paste its address into the app. |

To let Enable Banking make the key in the browser instead, choose *Generate in the browser* when you register the app and
upload the downloaded `.pem` file under *Muut vaihtoehdot > Minulla on .pem-tiedosto*. Delete the file afterwards.

A member can use an Enable Banking app of their own under *Asetukset > Oma Enable Banking -sovellus*. Usually the
shared one is enough.

## The maintenance helper

You need this when *Asetukset > Ylläpito* says "Ylläpitoapuri ei ole käytössä" or that the helper is out of date. The
buttons on that page work through a small helper on the machine, which the installer sets up. To set it up again:

```bash
./scripts/install.sh --ops-helper
```

It needs a normal user, never root, and `jq`. It runs once a minute from a systemd user timer, or from cron where a timer
cannot keep running. `./scripts/install.sh --ops-helper-off` removes it.

The app only writes a request. The helper checks it against a fixed list of nine actions (check for updates, update, roll
back, back up, restart, check the install, read the logs, free disk space and renew itself) and runs one of the project's
own scripts. Nothing from the database reaches a shell, and the address and port are never changed from the browser.
None of them takes a parameter. The logs are the last 100 lines of each running service with keys and tokens hidden. Freeing
disk space runs `docker image prune -f` and `docker builder prune -f`, which leave the running and the previous version
alone. Renewing runs `./scripts/install.sh --ops-helper` again, which keeps the saved remote and branch. An update does
the same after it succeeds, when the helper is on. The helper keeps its logs in `ops/`. If an
update and its rollback both fail, `ops/RECOVERY.txt` has the exact commands. What it is trusted with is in
[SECURITY.md](SECURITY.md#updates-and-the-maintenance-helper).

## Updates in detail

An update pulls the signed image from `ghcr.io` and checks its signature against the project's release workflow. It
copies the database before the new version starts, and goes back by itself if the new version does not start.
`./scripts/update.sh --yes` does the same from cron.

The copy taken before an update is kept for 14 days, and the newest one longer, so a rollback after a longer wait goes
back to that newest copy.

`TALOUS_CHANNEL` in `.env` chooses where updates come from. Without it, an install follows the signed releases and
builds from source only when its checkout is newer than the latest release. `release` always follows the releases and
`source` always builds the newest source on the machine. The next update uses the new value.

## Commands

| To | Run |
|---|---|
| Check the install | `./scripts/doctor.sh` |
| Update | `./scripts/update.sh` |
| Go back to the previous version | `./scripts/update.sh --rollback` |
| Back up into `backups/` | `./scripts/backup.sh` |
| Change how the app is reached | `./scripts/install.sh --reconfigure` |
| Follow the log | `docker compose logs -f banking` |
| Show the version | `docker compose exec banking node dist/node.js version` |
| Get a new setup code, before the first user exists | `docker compose exec banking node dist/node.js setup-code` |
| Reset a password | `docker compose exec banking node dist/node.js user reset-password <username>` |
| Sign everyone out | `docker compose exec banking node dist/node.js sessions revoke-all` |
| Stop or start | `docker compose stop`, `docker compose up -d` |
| Replace the app secret | `docker compose exec banking node dist/node.js secret rotate`, then `docker compose restart banking` |

Replace the app secret only with `secret rotate`. It copies the database, seals every saved bank key again under the new
secret and keeps the old one as `app_secret.prev-<time>` in the secrets volume. Delete that file after 14 days, when the
copies made before the rotation are gone.

## Settings in .env

The installer writes `.env`. You rarely need to change it by hand. After a change, run `docker compose up -d`.

| Key | Meaning |
|---|---|
| `INSTANCE_NAME` | names the container, the image and the login cookie of this copy |
| `COMPOSE_PROJECT_NAME` | names the data volumes, `<name>_banking-data` and `<name>_banking-secrets` |
| `HOST_PORT` | the port, from 8080 up |
| `BIND_ADDRESS` | the address the port listens on, the home network address by default |
| `CADDY_ADDRESS` | the address for Caddy's ports 80 and 443, needed only when two copies use their own domains |
| `TALOUS_CHANNEL` | where updates come from, see [Updates in detail](#updates-in-detail) |
| `TRUST_PROXY` | `true` behind Caddy or a tunnel, so the app sees each visitor's own address. The installer sets it. |

Never change `COMPOSE_PROJECT_NAME` of a copy that has data. The data stays in the volumes of the old name and the copy
starts empty. Changing `INSTANCE_NAME` signs everyone out. An install made before copies existed keeps the old names,
`banking-app`, whatever its folder is called.

The database lives in the volume `<name>_banking-data`, and `<name>_banking-secrets` holds the key that opens the saved
bank keys. Both survive restarts, updates and image rebuilds. Only `./scripts/reset.sh` and `docker compose down -v`
delete them.
