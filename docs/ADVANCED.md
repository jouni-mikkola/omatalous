# Advanced

Each section starts with when you need it. Run the commands on the machine, in the Omatalous folder (`cd ~/omatalous`).

| When you want to | Section |
|---|---|
| Use the app on your phone away from home | [Away from home](#away-from-home) |
| Give your parents or another household an Omatalous of their own | [A second copy on the same machine](#a-second-copy-on-the-same-machine) |
| Back up to a NAS, restore a backup, bring a damaged database back or move to a new machine | [Backups](#backups) |
| Empty the data and keep the install, or delete everything and install again | [Start over](#start-over) |
| Try Omatalous on your own Linux desktop | [On your own computer](#on-your-own-computer) |
| Install from a script without any questions | [Scripted install](#scripted-install) |
| Use a key made by Enable Banking, or give a member their own Enable Banking app | [Enable Banking options](#enable-banking-options) |
| Fix the *Ylläpito* buttons when the helper is missing, or see what the helper does by itself | [The maintenance helper](#the-maintenance-helper) |
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

Cloudflare Zero Trust has a free plan (up to 50 users) that covers the tunnel and the login in front of the app. Cloudflare
Access emails a one-time PIN to the addresses you allow, and then Omatalous asks for its own login. No port is opened and
there is no password for Access to keep.

You can set it up in the browser or with the installer's script. Both need Zero Trust and a Cloudflare API token, which
steps 1 and 2 of the script below make. The browser needs the maintenance helper, and the script works on any install.

#### From the browser

You need the maintenance helper in its current version (if *Asetukset > Tekniset asetukset > Ylläpito* or the page says it is missing or out
of date, run `./scripts/install.sh --ops-helper`), a copy that is reached at a home network address and does not use
its own domain with Caddy, and steps 1 and 2 of the script below.

1. As an admin open *Asetukset > Tekniset asetukset > Palvelin > Etäkäyttö*. Paste the token (*Cloudflaren API-tunniste*), press
   *Tallenna API-tunniste* and give your password. The app checks the token with Cloudflare and keeps it encrypted. It
   refuses a token that sees no active domain.
2. Give the address, for example `talous.example.fi`, with at most one label before the domain the token sees, and up to
   50 email addresses that may sign in. The page shows the address and every email back, and says that the home address
   stops answering. Confirm with *Kyllä, ota käyttöön* and your password.
3. The app makes the tunnel, the DNS record and the Access rule at Cloudflare, and the helper, which looks for work once a
   minute, switches the copy over. The page shows where the change stands.
4. From then on the home address answers 403 with the text *Pääsy estetty.* Open `https://talous.example.fi`, with
   Wi-Fi off on the phone, sign in through Cloudflare's one-time PIN and then to Omatalous. This has to happen within 15
   minutes. If nobody gets in by then, the server takes the new address off by itself and the home address works again.
5. Add the redirect URL under *Asetukset > Tekniset asetukset > Palvelin*, `https://talous.example.fi/api/connections/callback`, to your
   app's Redirect URLs in the Enable Banking Control Panel.

Changing who may sign in, and turning remote access off (*Ota etäkäyttö pois käytöstä*), are on the same page and ask
for the password. Turning it off shows where the app will answer afterwards. If that is the server itself only, you tick that you
understand it first. The page then takes the copy out of the tunnel and removes the tunnel, the DNS record and the
Access rule from Cloudflare, at the next visit to the page or within the hour. Access stays while something else
in Cloudflare still leads to the address, and the page says what. An address that the installer's script made cannot
be changed or removed on the page; use the script for it. A copy that was set up on the page can be taken back to the
home network from the machine with `./scripts/install.sh --reconfigure`. The helper keeps the `.env` from before its
last change as `ops/env.prev`, mode 600. The page shows the result of the last change for 24 hours. The API token
cannot be removed while remote access is on: save a new one to replace it, or turn remote access off first.
[SECURITY.md](SECURITY.md#remote-access-from-the-page) says what the page and the helper may do.

#### With the installer's script

The installer makes the tunnel, the address and the Access rule for you:

1. In the Cloudflare dashboard, turn on Zero Trust (choose the Free plan). The domain you want to use must be on the same
   Cloudflare account, and active there.
2. Under *My Profile > API Tokens* make a token with these permissions: Account: Cloudflare Tunnel Edit; Account: Access:
   Apps and Policies Edit; Account: Access: Organizations, Identity Providers, and Groups Edit; Zone: DNS Edit; Zone: Zone
   Read.
3. Once per machine, write the file `~/.config/omatalous/cloudflare.env` and make it private:

   ```
   CLOUDFLARE_API_TOKEN=the token from step 2
   CLOUDFLARE_BASE_DOMAIN=example.fi
   CLOUDFLARE_ACCESS_EMAILS=you@example.fi,partner@example.fi
   ```

   ```bash
   chmod 600 ~/.config/omatalous/cloudflare.env
   ```

   The installer refuses a file that others can read or that belongs to someone else, a link, and a file in a folder
   (`~/.config` or `~/.config/omatalous`) that others can write to. The emails are the default list of each copy, see
   below. Each one has the form the Etäkäyttö page takes: printable ASCII, one `@` and a host name after it that is
   no IP address, and the list holds at most 50. A list that breaks this stops the installer with exit code 2.
4. On the machine run:

   ```bash
   ./scripts/install.sh --access tunnel
   ```

   The installer builds the app, asks Cloudflare for the tunnel, the address `talous.example.fi` (it asks, and you can
   give another with `--domain`; with `--yes`, `--domain` is needed), the DNS record and the Access rule, and puts the
   tunnel's token in `.env`. An address that another copy (another folder or machine with the same file) already has in
   Cloudflare is refused and left as it is: give this copy its own address with `--domain`. It ends with
   the address and the redirect URL to add to your app's Redirect URLs in the Enable Banking Control Panel,
   `https://talous.example.fi/api/connections/callback`.
5. Check it: turn Wi-Fi off on the phone and open `https://talous.example.fi`.

Running the command again is safe: Cloudflare is asked again and says when nothing changed. A DNS record with the same
name that points elsewhere is never replaced. The installer stops and names it.

To change who may open the app, run this in the copy's folder. It saves the list in that copy's `.env` and updates the
Access rule:

```bash
./scripts/install.sh --access-emails you@example.fi,partner@example.fi
```

To remove the tunnel, the address and the Access rule that the installer made for a copy, run `./scripts/install.sh
--cloudflare-down` in its folder. Nothing else in your Cloudflare account is touched. Afterwards the app cannot be reached
by that address. Choose another way with `./scripts/install.sh --reconfigure`. The token's reach and how to revoke it are in
[SECURITY.md](SECURITY.md#keys-and-secrets).

The Access rule goes last, and only when nothing in Cloudflare leads to the address any more. If you added a second
host name to the copy's tunnel, or the address has a DNS record that points somewhere else, the command leaves that as
it is, keeps the Access rule, names what is still there and stops with an error. Remove it in the Cloudflare dashboard
and run the command again.

Without the file, or with `TALOUS_TUNNEL_TOKEN` given, you make the tunnel by hand:

1. In Zero Trust, open *Networks > Tunnels* and create a tunnel of the Cloudflared type. Copy its token. It starts with
   `eyJ`. Skip the connector install that Cloudflare offers, because Omatalous runs the connector itself.
2. Give the tunnel a public hostname, for example `talous.example.fi`, with the service `http://banking:8080`. That is the
   app's name inside Omatalous, and it is the same for every install.
3. Add an Access application for the same hostname with a policy that lets in only your own email addresses.
4. On the machine run:

   ```bash
   TALOUS_TUNNEL_TOKEN=eyJ... ./scripts/install.sh --access tunnel --domain talous.example.fi
   ```

5. Open `https://talous.example.fi`, add the redirect URL under *Asetukset > Tekniset asetukset > Palvelin*,
   `https://talous.example.fi/api/connections/callback`, to your app's Redirect URLs in the Enable Banking Control Panel,
   and check it from the phone with Wi-Fi off.

From now on the household uses the https address at home too. The old `http://` address stops working. Cloudflare sees
the traffic unencrypted on its way through.

The app can also check Cloudflare Access's signature on every request, so that a deleted Access application or a Bypass
policy shows nobody the login page. It does so when `.env` has `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN`. Where the
installer or the page makes the tunnel, they are written for you, and `./scripts/install.sh --cloudflare-down` and a
change to another way in remove them. An install from 0.8.6 gets them by running `./scripts/install.sh --access tunnel`
once. For a tunnel made by hand, copy the Application Audience (AUD) Tag from the Access application and the team domain
(`<team>.cloudflareaccess.com`) from the Zero Trust settings into `.env`, then run `docker compose up -d`. The
installer keeps the pair while the address stays. With the check on, `http://localhost:<port>` on the machine answers 403
too, and only the Cloudflare address works. If everything answers 403 after you set the values by hand, one of them is
wrong: fix it, or remove both lines and run `docker compose up -d`.

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
4. Open `https://talous.example.fi` and add the redirect URL under *Asetukset > Tekniset asetukset > Palvelin*,
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

The copy starts on the release this clone is at, with the signed image, so it runs what the first one runs. When the
clone is not at a release (no tag `vX.Y.Z` at its head, or a release that is not on `origin/main`), the copy stays on
the head of the branch, is built from source, and the installer prints one line that says so. It never takes a newer
release by itself. The copy does not ask GitHub which release is out, as a new install in a clone made by hand does
(see [Install](INSTALL.md#1-get-omatalous)): it takes the release the first copy runs. Update it later as any copy.

The copy needs its own Enable Banking app, because it makes its own key. The person whose accounts it reads registers it
as in [ENABLE_BANKING.md](ENABLE_BANKING.md).

Run the copy's commands in its own folder, for example `cd ~/isa && ./scripts/update.sh`. Its *Ylläpito* page updates
and backs up only that copy.

To use the copy away from home:

- A VPN to your home covers every copy.
- With the Cloudflare file of [Cloudflare Tunnel](#cloudflare-tunnel), `./scripts/install.sh --new-instance isa --access
  tunnel` gives the copy a tunnel and the address `isa.example.fi` by itself. The copy lets in the addresses of the file
  unless you give its own: add `--access-emails mother@example.fi,father@example.fi`. To change that list later, run
  `./scripts/install.sh --access-emails ...` in the copy's folder.
- With your own domain, only one copy can have ports 80 and 443 on an address. A second copy needs another IP address of
  the machine or a Cloudflare Tunnel. The installer asks for the address when 80 and 443 are taken.

How the copies are kept apart is in [Settings in .env](#settings-in-env).

## Backups

Omatalous copies its database once a day and keeps the seven newest copies on the machine. They help after a bad update
but not if the disk breaks. For most households it is enough to download *Lataa uusin* under *Asetukset > Tekniset asetukset > Ylläpito* now
and then. Set up the daily backup below when you want copies on a NAS without pressing anything.

### Daily backup to a NAS

1. Mount the NAS share on the machine, for example at `/mnt/nas`. Your NAS's guide shows how.
2. Make an encryption key and keep the key file somewhere else than the NAS, for example in your password manager:

   ```bash
   sudo apt install -y age
   age-keygen -o ~/omatalous-backup.key    # prints the public key, age1...
   ```

3. Put two lines in the copy's `.env`, with your own public key and the folder on the NAS:

   ```
   BACKUP_AGE_RECIPIENT=age1...
   BACKUP_COPY_TO=/mnt/nas/omatalous
   ```

   The scheduled run and the *Varmuuskopio* button read them from there. Leave the second line out to keep the copies
   on the machine only.
4. Try it once, then schedule it:

   ```bash
   ./scripts/backup.sh
   ./scripts/backup.sh --schedule    # every day at 03:30; --schedule 02:15 for another time
   ```

   It adds one line for this folder to your crontab. Running it again replaces that line, and
   `./scripts/backup.sh --unschedule` removes it.
5. Check it the next morning: `ls -l backups/` lists `talous-<time>.db.gz.age` and `talous-<time>.app_secret.age`, and
   the same files are on the NAS. `backups/backup.log` has the output of each run.

The copy goes to the NAS only while the share is mounted and writable. Otherwise the log says so and the backup stays in
`backups/`. Nothing is deleted on the NAS. Each file goes in under a hidden temporary name and gets its final name only
after it matches the original. The copy never writes through a link on the share: a link at the temporary name is
replaced, and a link at a file's final name stops the copy with a warning.

`backup.sh` keeps 7 days in `backups/`: after each good backup it deletes the `talous-*` files that are 8 days old or
older, and never the files it has just made. To keep a month, put the line `KEEP_DAYS=30` in `.env` (a value in the
shell wins over it). The folder of `BACKUP_COPY_TO` is never pruned. The `.app_secret.age` file holds the key that opens
the saved bank keys, so a restore on a new machine keeps the bank connections. Without `BACKUP_AGE_RECIPIENT` the files are not encrypted and the
app secret is not backed up.

With several copies, run `--schedule` in each copy's folder and give each its own `BACKUP_COPY_TO` folder.

### The app's own copies

The app keeps its copies in the data volume, in `/data/backups`: the daily `auto-` copy, and a `pre-` copy before an
update, a rollback, a restore, a reset or a secret rotation. *Lataa uusin* gives the newest one to your device.

- The three newest copies that pass the integrity check are never deleted, whatever their age or name. A `pre-restore-`
  copy is not one of the three, and a `pre-reset-` copy is also kept for 14 days. While the live database fails its
  check nothing is deleted, and the log says `database copies are not pruned`.
- A copy needs twice the size of the database and its `-wal` file free in the folder it goes to. Without that room the
  copy is not made, and the app, `backup.sh` and `update.sh` say how much is free and how much is needed. A daily copy
  that was refused for room is logged as `backup failed:` and tried again at the next hourly tick. If the room is
  missing before a migration, the server does not start and the database is unchanged.
- The file `/data/.reserve` is 64 MB of zeros. The app writes it at start and at the hourly tick when it is missing
  and over 1 GB is free. It deletes the file when under 128 MB is free, so that signing in and freeing space still work,
  and the log says "the data disk is nearly full". Deleting the file by hand is safe and gives 64 MB at once.
  `backup.sh` does not include it.
- Once a week, an hour after the daily copy, the app checks the newest copy in full (about a second and a half for a
  200 MB database). It leaves the copies alone while any copy's file changed in the last two minutes and runs at the
  next hourly tick. A copy that fails is renamed `<name>.damaged`. It stays in `/data/backups` until you delete it by
  hand, is not restored from and is not protected.
- Admins see four notices on the notice list. *Ehjää varmuuskopiota ei ole tehty 36 tuntiin.* (not in the first 36
  hours of an install), *Varmuuskopio ... ei läpäissyt tarkistusta eikä sitä enää käytetä palautukseen.*,
  *Palvelimen levyllä on enää ... Mt vapaata tilaa.* (under 1 GB free, or the reserve given up) and *Ylläpitoapurista
  ei ole kuulunut vuorokauteen.* (24 hours after the helper was last seen). *Kuittaa* hides a notice until its
  problem ends and comes back.

### Restore a backup

You need this when the database is damaged or you want an earlier state back. It replaces all data with the backup.

In the copy's folder, with the file on the machine (copy a file from *Lataa uusin* there, for example with `scp`):

```bash
./scripts/restore.sh auto-2026-10-09.db
./scripts/restore.sh backups/talous-20261009-033000.db.gz
./scripts/restore.sh backups/talous-20261009-033000.db.gz.age    # key ~/omatalous-backup.key, or --key <file>
```

It refuses a file that is not a database before it stops the app. Then it stops the app, restores, starts the app and
sets *Sovelluksen osoite* to `APP_BASE_URL` from `.env`. When something fails after the stop, the app starts again with
the database it had. The last lines say what was restored and where the previous copy is.

`restore` checks the file first (size, integrity, this app's tables) and refuses a bad one without changing anything.
It saves the current database as `backups/pre-restore-<time>.db` in the data volume before it swaps.

From one of the app's own copies (`docker compose run --rm --no-deps -T --entrypoint ls banking /data/backups` lists them):

```bash
docker compose stop banking
docker compose run --rm --no-deps -T banking node --disable-warning=ExperimentalWarning dist/node.js restore backups/auto-2026-10-09.db
docker compose start banking
```

It worked when you can log in and the newest transactions are from the day of the backup.

An empty or table-less `banking.db` next to saved copies is never started as a new install. The log says so and names
the newest copy to restore.

#### When the app moved a damaged database

At every start of the server (not for commands such as `restore`) the app checks the database with SQLite's own check.
A damaged file goes with its `-wal` and `-shm` files to `/data/damaged/banking-<time>.db`, and the newest intact copy
takes its place. Nothing is deleted, and the app never empties `/data/damaged`: remove old files there by hand.
Changes made after that copy are lost, and the next bank fetch brings the transactions again. The log lines start with
`database:`. Every admin gets a notice, *Tietokanta oli vaurioitunut. Se palautettiin varmuuskopiosta ...*, and the
security log has the entry *Tietokanta palautettu varmuuskopiosta*.

With no intact copy the app does not stop, because a stop at start would loop. It starts on the damaged file, and the
notice reads *Tietokanta on vaurioitunut, eikä ehjää varmuuskopiota löytynyt. Palauta muualle tallennettu
varmuuskopio palvelimella komennolla ./scripts/restore.sh. Ohje on tiedostossa docs/ADVANCED.md.* The security log
calls it *Tietokanta vaurioitunut*. Put a copy you kept elsewhere on the machine (a file from *Lataa uusin*, a copy on
the NAS, a `backups/talous-*.db.gz`) and restore it as above.

When an intact copy exists but could not be put in place, most often for lack of room on the disk, the notice says
*Tietokanta on vaurioitunut. Ehjä varmuuskopio ... on tallessa, mutta sitä ei saatu käyttöön.* Free space on the disk
and run `docker compose restart banking`: the next start puts the copy in place. If that does not help, restore it by
hand as above.

#### Restore the newest copy from the browser

*Asetukset > Tekniset asetukset > Ylläpito > Palauta uusin varmuuskopio* replaces the database with the newest intact copy in
`/data/backups`. The admin gives the password and types `PALAUTA`. The app then ends by itself, as `docker stop` ends it,
and Docker's restart policy starts it again (`restart: unless-stopped` in `docker-compose.yml`). The copy goes in at
that start. Nothing else starts the app: with no restart policy, with `on-failure` or with a bare `node` process the
page stays dead until you run `docker compose up -d` in the install folder. If the page does not come back in a minute,
run that. A request waits 15 minutes. A start later than that restores nothing, removes the request and tells the
admins that the data is as it was, and the admin asks again. Removing the file `/data/.restore-request` before the
start cancels the request.

The database that was replaced is saved as `pre-restore-<time>.db` in `/data/backups`. The button never takes that
copy as the newest. To go back to it, use the `restore` command with its name. Changes made after the copy are lost, and
the bank transactions come again at the next fetch. The other admins get a notice when the restore is asked, and the
notice after the start says who restored the database (*palautti tietokannan varmuuskopiosta*) or that nothing was
done. The log has `restore request: backups/<name> is restored at the next start. Stopping for it.` and then
`database: restored from backups/<name>, as asked in the browser.`

### Move to a new machine

1. Install Omatalous on the new machine as [INSTALL.md](INSTALL.md) says, but do not create a user.
2. Copy the backup files over and restore with the app secret:

   ```bash
   ./scripts/restore.sh talous-20261009-033000.db.gz.age --secret talous-20261009-033000.app_secret.age
   ```

   The new machine's own secret stays in the secrets volume as `app_secret.prev-<time>`. The script first tries the
   file on the restored database. A file that does not open the saved bank keys, such as another copy's secret, is
   refused and the current secret stays.
3. Log in at the new address. The script set *Sovelluksen osoite* from `.env`.

Without the app secret your users, transactions and settings come back, but the saved bank keys stay locked. Set
Enable Banking up again under *Asetukset > Tekniset asetukset > Palvelin* as [ENABLE_BANKING.md](ENABLE_BANKING.md) says and connect the
accounts again.

## Start over

You need this when you want to empty the data, or to delete the install and all its data, for example after testing.

### Empty the data and keep the install

*Asetukset > Tekniset asetukset > Ylläpito > Tyhjennä kaikki tiedot* starts again with an empty database on the same install. The admin gives
the password and types `TYHJENNÄ`. It deletes every member except the admin who asks, and all accounts, transactions,
rules, marks, loans, expected bills, saving tips, bank keys and bank connections. It keeps that admin's account and
password, the server's settings, the shared bank application and the answers of the trade register about companies.
Payee names the register did not find as a company are deleted. Everyone is signed out.

A copy `pre-reset-<time>.db` is made first in `/data/backups` and kept at least 14 days. The list of copies on the
page shows it as *ennen tyhjennystä*. Restoring it undoes the
reset. *Palauta uusin varmuuskopio* does that only while this copy is the newest, which is until the next daily
copy, less than a day later. After that restore it by its name as in [Restore a backup](#restore-a-backup). A restore
brings the rows back and not the bank connections, so connect every bank again. The reset ends the bank consents at the
bank first, and one that could not be ended expires there on its own.

The reset removes no copy. Older `auto-` and `pre-` copies, `/data/damaged` and the archives of the host keep the data
until they are pruned or deleted by hand. What a member saves between the copy and the delete is in neither, so empty
the data when nobody else uses the app. The reset is refused while a bank fetch runs (*Tietojen haku on kesken. Yritä
hetken päästä uudelleen.*) and while a restore waits for the restart or another action runs (*Toinen toiminto on
kesken.*). A wrong word is recorded in the security log as *Ylläpitopyyntö estetty*, detail "tietojen tyhjennys:
vahvistus".

### Delete the install

```bash
./scripts/reset.sh
```

It offers a backup first and asks you to type `POISTA` before it deletes anything. It removes the containers, the image of this install,
the data, the app secret, the maintenance helper with its launcher folder and `.env`. The `backups/` folder stays, but a backup made without
`age` can no longer open the bank keys. Install again with `./scripts/install.sh`. With several copies it removes only
the copy of the folder it runs in.

## On your own computer

You need this to try Omatalous on a Linux desktop that is not always on. Use the install steps in
[INSTALL.md](INSTALL.md) with one change in the last line:

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
| `--access-emails a@example.fi,b@example.fi` | `TALOUS_ACCESS_EMAILS` | for `tunnel` made from the Cloudflare file, who Cloudflare Access lets in. Kept in the copy's `.env` |
| `--port 8080` | `TALOUS_PORT` | the port, default the first free one from 8080 |
| `--name isa` | `TALOUS_NAME` | the copy's name, default the folder name |
| `--no-ops-helper` | `TALOUS_OPS_HELPER=0` | leave the maintenance helper out |
| `--reconfigure` | | show the access menu again on an existing install |
| `--cloudflare-down` | | remove the tunnel, address and Access rule the installer made for this copy, and nothing else |

A token alone means `tunnel`, and so does `--access-emails` alone. `--domain` with `--email` means `domain`. A run on an
existing install keeps its `.env` unless `--reconfigure` or an answer flag is given. The last lines of the output hold
the address and the setup link.

`scripts/cloudflare-setup.sh` writes the Cloudflare file (`~/.config/omatalous/cloudflare.env`) that `tunnel` reads. It
asks for the API token, hidden, and checks it with Cloudflare. Make the token under *My Profile > API Tokens* in the
Cloudflare dashboard, with the permissions in [Cloudflare Tunnel](#cloudflare-tunnel); an account token is refused.
Without questions, give the token in the environment:

```bash
CLOUDFLARE_API_TOKEN=... ./scripts/cloudflare-setup.sh --yes --domain example.fi --emails you@example.fi
```

It needs `curl` and `jq` (`sudo apt install -y jq`).

## Enable Banking options

The redirect URL to register depends on how the app is reached. *Asetukset > Tekniset asetukset > Palvelin* always shows the right one.

| The app is reached at | Redirect URL |
|---|---|
| A home network address (the default) | `https://jouni-mikkola.github.io/omatalous/callback/`, the project's return page. It sends the browser on to your own address, and only to private addresses. |
| Your own https address | `https://<address>/api/connections/callback` |
| An install made before the return page, until you press *Ota käyttöön* | `https://localhost/api/connections/callback`. The bank then shows an error page, and you paste its address into the app. |

To let Enable Banking make the key in the browser instead, choose *Generate in the browser* when you register the app and
upload the downloaded `.pem` file under *Muut vaihtoehdot > Minulla on .pem-tiedosto*. Delete the file afterwards.

A member can use an Enable Banking app of their own under *Asetukset > Oma Enable Banking -sovellus*, see
[A member's own app](ENABLE_BANKING.md#a-members-own-app). The card shows when the household has no shared app, or
when the member already uses an own key.

## The maintenance helper

You need this when *Asetukset > Tekniset asetukset > Ylläpito* says "Ylläpitoapuri ei ole käytössä" or that the helper is out of date. The
buttons on that page work through a small helper on the machine, which the installer sets up. To set it up again:

```bash
./scripts/install.sh --ops-helper
```

It needs a normal user, never root, and `jq`. It runs once a minute from a systemd user timer, or from cron where a timer
cannot keep running. `./scripts/install.sh --ops-helper-off` removes it.

The app only writes a request. The helper checks it against a fixed list of twelve actions (check for updates, update, roll
back, back up, restart, check the install, read the logs, free disk space, renew itself, change how the copy is
reached, and turn the switch for new versions on or off, see [Updates in detail](#updates-in-detail)) and runs one of
the project's own scripts. Nothing from the database reaches a shell, and the port is never
changed from the browser. Changing how the copy is reached belongs to the Etäkäyttö page, see [Cloudflare Tunnel](#cloudflare-tunnel):
it rewrites `.env` from a request file the app checked and the helper checks again, and *Ylläpito* has no button for it.
None of them takes a parameter. The logs are the last 100 lines of each running service with keys and tokens hidden. Freeing
disk space runs `docker image prune -f` and `docker builder prune -f`, which leave the running and the previous version
alone. Renewing runs `./scripts/install.sh --ops-helper` again, which keeps the saved remote and branch. An update does
the same after it succeeds, when the helper is on. The helper keeps its logs in `ops/`. If an
update and its rollback both fail, `ops/RECOVERY.txt` has the exact commands. What it is trusted with is in
[SECURITY.md](SECURITY.md#updates-and-the-maintenance-helper).

### What the helper does by itself

Besides the buttons the helper does five things on its own. Each writes a line to `ops/helper.log`, which the
*Ylläpito* page and `./scripts/doctor.sh` read.

#### The launcher

The timer or the cron line runs `~/.local/share/omatalous/<name>/launcher.sh` with the clone's folder as its only
argument, and not the clone's own helper (`<name>` is the instance name, and `$XDG_DATA_HOME` replaces
`~/.local/share` when it is an absolute path). The launcher lives outside the clone, so no update replaces the file the
timer runs. It runs the clone's `scripts/ops-helper.sh` when that file and every file in `scripts/lib` parse. After a
tick that ended well it runs the helper's self-test, and only a helper that passes keeps a copy of itself and
`scripts/lib` in `last-good/` beside the launcher. A helper that fails the test leaves the earlier copy where it is and
is tested again on every tenth tick, so a broken helper adds one `self-test failed` line to `ops/helper.log` in ten
ticks and not one in every tick. The launcher refuses to run as root, and it runs no file that someone else owns or
that group or others can write to.

When the clone's helper is missing or does not parse, for example after an update that went wrong, the launcher runs
the last good copy for the clone, so *Päivitä* and *Palauta edellinen versio* still work from the browser. `ops/helper.log`
then has a line such as "launcher: the helper of this folder cannot be run (REASON). The last good copy of it runs
instead; update or go back to the previous version to get a working one." The line comes once in ten minutes, and at
once when the reason changes. The file `.note` beside the launcher holds the newest text, `launcher.log` there holds the
lines that cannot go to `ops/helper.log`, and `./scripts/doctor.sh` warns too. Press *Päivitä* or *Palauta edellinen
versio*, or run `./scripts/update.sh`, to get a helper that works. With no usable copy nothing runs and the line says
so. `./scripts/install.sh --ops-helper` puts the launcher in place and replaces an older one. `./scripts/install.sh
--ops-helper-off` and `./scripts/reset.sh` remove its folder. A tick by hand with `./scripts/ops-helper.sh` still works.

#### The self-test

`./scripts/ops-helper.sh --self-test`, run as your normal user and never as root, prints `self-test ok` or
`self-test failed: <reason>`, exits 0 or 1 and changes nothing but one line in `ops/helper.log`. It checks that every
script parses, that `timeout` and `flock` exist, that the files are safe to run, that `.env` is valid, that Docker
answers and that the app answers its health check and tells its version. A check of Docker or the app that fails gets a
second look after ten seconds.

An update from the page tests the helper that the new version brought, once the new version answers. When the test
fails, the helper takes the update back at once, as long as the update's record `backups/.last-update` is under 60
minutes old. The data follows the usual rollback rule, see [Updates in detail](#updates-in-detail). The result reads
*Edellinen versio palautettiin, koska uusi ylläpitoapuri ei toiminut* and the reason, and every admin gets a notice.
With no fresh record the new version stays and the result says *Päivitystä ei palautettu, koska tuoretta
varmuuskopiota ei ole.* Then repair the helper on the machine; `./scripts/update.sh --rollback` is still there. An
update run by hand with `./scripts/update.sh` does not run the self-test. The first update it guards is the one from
0.9.0 to the next release, because the update to 0.9.0 itself is run by the helper of the older version.

#### The watchdog

For one hour after an update the helper looks at the app on every tick. When the app has been restarting, unhealthy by
Docker's health check, or running without answering `/api/health` for ten minutes in a row, the helper runs
`./scripts/update.sh --rollback --yes` itself, once per update. It does nothing when the container was stopped or
removed by hand, while `install.sh` or `update.sh` runs, while a request from the page runs, and when the app was
already unhealthy before the update began. To keep a broken version up for debugging, stop the container (`docker
compose stop`) or create the file `ops/watchdog-<AT>`, where `<AT>` is the `AT` line of `backups/.last-update`.

After a rollback `ops/helper.log` has lines that start with `watchdog:`, and `ops/run/watchdog-<AT>.log` has the last 60
log lines of the app from before the rollback and the output of `update.sh`; it is kept 30 days. The page lists the
rollback among the checks, and every admin gets a notice that begins *Edellinen versio palautettiin, koska sovellus ei
vastannut 10 minuuttiin*. The daily check offers the version that was taken back again, within a day. When the rollback
does not bring the app back, `ops/RECOVERY.txt` has the commands to run by hand, and the helper does not try again.

#### The address

In the home network mode the helper follows the machine to a new address. It acts when the address in `BIND_ADDRESS`
has been gone from the machine for ten minutes and the network interface that had it has exactly one private address
now (10/8, 172.16/12 or 192.168/16). It then writes the new address to `.env` (and to `APP_BASE_URL` when that was the
installer's own `http://` address), starts the app on it, and does so at most once an hour. The app restarts once.
`ops/helper.log` and the journal (`journalctl --user -u talous-ops-<name>`) get one line that tells the new address,
"Osoite vaihtui: http://10.0.0.5:8080". *Asetukset > Tekniset asetukset > Palvelin* may still show the old address. A reservation of the
address in the router remains the better advice.

It follows only the interface that had the address, and never a tunnel or a point-to-point link such as a VPN. It does
nothing with a Cloudflare Tunnel or Caddy, and without the helper (`--ops-helper-off`) nothing follows, so
`./scripts/install.sh --reconfigure` is the way. A machine carried to another network keeps its old address until you
run the installer when it joins the other network with another interface (wired at home, wireless elsewhere) or gets
no private address there. When the same interface gets a private address in the other network, for example a laptop's
Wi-Fi on a guest network, the app follows it after ten minutes, because the helper cannot tell that from a new router at
home. An install whose address was already gone when 0.9.0 arrived has no kept interface and does not follow.

#### The disk

When the disk Docker stores on has under 3 GB free, the helper removes this app's old images by itself, as *Siivoa
levy* does, with two differences: only untagged images that carry this app's label (`talous.version`, set on every
image since 0.3.0) go, and the build cache stays. The daily round looks, at most once in six hours, and one line in
`ops/helper.log` tells the free space before and after ("housekeeping: Docker's disk (...) had N MB free; pruned this
app's old images; now M MB free"). It never touches a volume (the data and the backups), the running version, the
previous version or the tagged images of other software. A release image arrives with a registry tag. The update reads
the image's id right after the pull and tags the image `:latest` by that id, then removes the registry tag, so that an old
version is untagged and the cleaning can free it, so it frees every older image and leaves the running version and the
previous one. *Siivoa levy* ("Poistaa vanhat versiot ja välimuistin.") is unchanged and also removes the build cache.

#### Files in ops/

Beside the journal and `RECOVERY.txt`: `watchdog-since`, `watchdog-<AT>` and `watchdog.frag` (the watchdog's count, a
settled update and its report), `address-if`, `address-since`, `address-at`, `address-doing` and `run/address.log` (the
address follow-up, which also writes `env.prev` and `env.written`) and `housekeeping-at` (the time of the last cleaning
try). Leave them alone.

## Updates in detail

An update pulls the signed image from `ghcr.io` and checks its signature against the project's release workflow. It
copies the database before the new version starts, and goes back by itself if the new version does not start.
`./scripts/update.sh --yes` does the same from cron.

Two copies of Omatalous on one machine may fetch the same version at the same moment, and the one that finishes first
removes the registry tag of the image. The other update then pulls the image once more and goes on. If the tag is gone
again after that second pull, the update stops and the old version keeps running. When the script asks GitHub which
release is out and GitHub answers 403 or 429, the limit of requests for the address was met (60 an hour without a
token). `./scripts/update.sh` run by hand then says "GitHub turned the request down: the limit of requests for this
address was met. Nothing was changed. Wait an hour and run this again." It does not try again.

The copy taken before an update is kept for 14 days, and the newest one longer, so a rollback after a longer wait goes
back to that newest copy. The three newest intact copies of any kind are never deleted, see
[The app's own copies](#the-apps-own-copies).

Before the old version stops, the update tries the new version's database changes on that copy, in a separate
container (`node dist/node.js migrate-check`, which needs room for about twice the database in the data volume). If the
check fails, the update stops with exit code 3 and the old version keeps running, with nothing changed. If the check
could not run at all (a Docker error, no memory), the exit code is 4 and nothing is known about the migrations. The check
is skipped when the new image does not have the command. How long the check took sets how long the new version may take
to start: three times that, at least two minutes and at most 15, and never beyond the time the maintenance helper has
left for the update. The update records whether it changed the database structure, and *Asetukset > Tekniset asetukset > Ylläpito* warns
before a rollback that data written since the update is lost if the previous version cannot read the updated database,
also when the update did not record an answer.

An update that stops or is interrupted before the new version starts puts the old image back as the current one, and in
the source channel the checkout back on the commit that runs, so the next run starts again from the beginning.

`./scripts/update.sh --rollback` first checks the copy named in `backups/.last-update` (it exists and passes
`quick_check`) and stops nothing if it does not. The state file and every database copy are flushed to disk before they
count.

With the app stopped, the rollback compares the migration history of the database with that copy. If it differs, the
rollback asks the previous image whether it opens the database as it is: `node dist/node.js migrate-check
/data/banking.db` in a one-off container without network, for at most two minutes. From 0.6.0 on the answer is yes when
every newer migration has a compat floor at or below the previous version and the previous version has no migration of
its own to apply. The database then stays, so marks, expected bills and everything else written since the update are
kept. Any other answer restores the newest copy with the old schema, and what was written since the
update is lost: the check refused the database, the previous image has no such command (0.5.x and older), Docker failed
or the check took too long. Both ways the current database is saved first in the data volume as
`/data/backups/pre-rollback-*.db`.

Each release starts on GitHub as a pre-release, and an install follows the latest full release. The project's promotion
workflow, which looks every six hours, promotes a release once it is 48 hours old, so an install is offered it two days
after it came out. The daily check, *Päivitä* and `./scripts/update.sh` all wait for that, and nothing installs by
itself. With the switch *Tarjoa uudet versiot heti* under *Asetukset > Tekniset asetukset > Ylläpito* on, they follow the newest release
instead, a pre-release too. The maintenance helper then sets the line `TALOUS_PRERELEASE=yes` in `.env`, or `no` when
the switch is turned off, leaves every other line as it was and checks for a new version at once. An install without
the helper has no switch: write the line in `.env` by hand. The default is `no`. The key does nothing with
`TALOUS_CHANNEL=source` and such an install has no switch, but a value other than `yes` or `no` is refused there too, and
the installer keeps the key over a re-run. An install that is on a pre-release stays there when the key is off or
removed, and `update.sh` says "Already on vX.Y.Z, newer than the latest release (vY). TALOUS_PRERELEASE=yes in .env
follows releases during their first two days. Nothing was changed." The project holds a release back by making it a
draft, and pulls one by deleting it; neither mode sees a draft or a pulled release. The 48 hours hold only for installs
that already run 0.9.0. An install of 0.8.x that is updated by hand with `./scripts/update.sh` takes v0.9.0 from the first
minute, because the script of 0.8.x takes the newest tag.

`TALOUS_CHANNEL` in `.env` chooses where updates come from. Without it, an install follows the signed releases and
builds from source only when its checkout is newer than the latest release. `release` always follows the releases and
`source` always builds the newest source on the machine. The next update uses the new value.

## Commands

| To | Run |
|---|---|
| Check the install | `./scripts/doctor.sh` |
| Test the maintenance helper, as your normal user | `./scripts/ops-helper.sh --self-test` |
| Update | `./scripts/update.sh` |
| Go back to the previous version | `./scripts/update.sh --rollback` |
| Back up into `backups/` | `./scripts/backup.sh` |
| Back up every day (03:30 without a time), or stop it | `./scripts/backup.sh --schedule [HH:MM]`, `./scripts/backup.sh --unschedule` |
| Restore a backup | `./scripts/restore.sh <file> [--secret <file>] [--key <file>]` |
| Change how the app is reached | `./scripts/install.sh --reconfigure` |
| Write the Cloudflare file | `./scripts/cloudflare-setup.sh` |
| Change who Cloudflare Access lets in | `./scripts/install.sh --access-emails a@example.fi,b@example.fi` |
| Remove the copy's Cloudflare tunnel, address and Access rule | `./scripts/install.sh --cloudflare-down` |
| Follow the log | `docker compose logs -f banking` |
| Show the version | `docker compose exec banking node dist/node.js version` |
| Get a new setup code, before the first user exists (a generated code works for 24 hours) | `docker compose exec banking node dist/node.js setup-code` |
| Reset a password | `docker compose exec banking node dist/node.js user reset-password <username>` |
| Sign everyone out | `docker compose exec banking node dist/node.js sessions revoke-all` |
| Stop or start | `docker compose stop`, `docker compose up -d` |
| Replace the app secret | `docker compose exec banking node dist/node.js secret rotate`, then `docker compose restart banking` |

Replace the app secret only with `secret rotate`. It copies the database, seals every saved bank key again under the new
secret and keeps the old one as `app_secret.prev-<time>` in the secrets volume. Delete that file after 14 days, when the
copies made before the rotation are gone.

## Settings in .env

The installer writes `.env`. You rarely need to change it by hand. After a change, run `docker compose up -d`.

Four jobs change `.env` after the first install: remote access on the Etäkäyttö page, a new home network address, the
switch *Tarjoa uudet versiot heti* and the Cloudflare setup of the installer. All four write it the same way: a whole new
file beside it, then one rename. A stop at any moment (a kill, a power cut, a full disk) leaves the old file or the new
one, never half of one, and a line of any other key stays as it was.

| Key | Meaning |
|---|---|
| `INSTANCE_NAME` | names the container, the image and the login cookie of this copy |
| `COMPOSE_PROJECT_NAME` | names the data volumes, `<name>_banking-data` and `<name>_banking-secrets` |
| `HOST_PORT` | the port, from 8080 up |
| `BIND_ADDRESS` | the address the port listens on, the home network address by default |
| `CADDY_ADDRESS` | the address for Caddy's ports 80 and 443, needed only when two copies use their own domains |
| `TALOUS_CHANNEL` | where updates come from, see [Updates in detail](#updates-in-detail). It stays over a re-run and `--reconfigure`. |
| `TALOUS_PRERELEASE` | `yes` or `no`, default `no`. `yes` follows the newest release, a pre-release too, in its first 48 hours, see [Updates in detail](#updates-in-detail). The switch *Tarjoa uudet versiot heti* under *Asetukset > Tekniset asetukset > Ylläpito* sets it. It stays over a re-run and `--reconfigure`. |
| `TRUST_PROXY` | `true` behind Caddy or a tunnel, so the app sees each visitor's own address. The installer sets it. |
| `CLOUDFLARE_ACCESS_EMAILS` | who Cloudflare Access lets in to this copy, comma-separated. `./scripts/install.sh --access-emails` changes it and the Access rule together. Each address is printable ASCII with one `@` and a host name that is no IP address, at most 50 in all. |
| `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN` | the Access application's audience tag and the team domain. With both set the app checks Cloudflare's signature on every request, see [Cloudflare Tunnel](#cloudflare-tunnel). Set both or neither. The installer and the Etäkäyttö page write them. |
| `ACCESS_LAN_BIND` | the address the port had before the Etäkäyttö page moved it to `127.0.0.1`. The page puts it back when remote access is turned off. Leave it alone. |
| `BACKUP_AGE_RECIPIENT` | the public `age` key that `backup.sh` encrypts to, see [Daily backup to a NAS](#daily-backup-to-a-nas) |
| `BACKUP_COPY_TO` | a folder on a mounted NAS that `backup.sh` copies each backup to |

Never change `COMPOSE_PROJECT_NAME` of a copy that has data. The data stays in the volumes of the old name and the copy
starts empty. Changing `INSTANCE_NAME` signs everyone out. An install made before copies existed keeps the old names,
`banking-app`, whatever its folder is called.

The database lives in the volume `<name>_banking-data`, and `<name>_banking-secrets` holds the key that opens the saved
bank keys. Both survive restarts, updates and image rebuilds. Only `./scripts/reset.sh` and `docker compose down -v`
delete them.
