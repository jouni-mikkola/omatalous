# Advanced

Each section starts with when you need it. Run the commands on the machine, in the Omatalous folder (`cd ~/omatalous`).

| When you want to | Section |
|---|---|
| Use the app on your phone away from home | [Away from home](#away-from-home) |
| Give your parents or another household an Omatalous of their own | [A second copy on the same machine](#a-second-copy-on-the-same-machine) |
| Back up the data yourself, put a copy back or move to a new machine | [Your own backup](#your-own-backup) |
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
| [A https name for the home network](#a-https-name-for-the-home-network) | You want https inside the home only, for example to link a bank without the return page, and you run a reverse proxy and a certificate authority of your own. | A name such as `koti.home.arpa`, a reverse proxy, a certificate authority |
| [Own domain](#own-domain) | Your internet has a public address and you want a normal https address. The login page is then on the internet. | A domain, two forwarded ports |

Your internet has a public address when the internet address in your router's status page is the same one a site such
as `ifconfig.me` shows. 4G and 5G home internet usually has none.

### VPN

1. Turn on the VPN server in your router and add the phone, following the router's instructions.
2. Install the VPN app on the phone and connect.
3. Check it: turn Wi-Fi off on the phone and open the same address you use at home. Omatalous opens.

Nothing changes in Omatalous. Linking a bank works over the VPN too.

### A https name for the home network

Enable Banking accepts a private https name as the return address ([Bank connection notes](BANK_NOTES.md#private-return-names)). The bank sends the browser back to it with `code` and `state`; Enable Banking never opens the address itself,
so it can resolve only inside your home. Use a name that cannot exist on the internet: `.home.arpa` (RFC 8375) or `.lan`.
The app stays closed to the internet, as with the VPN.

1. Make the name resolve to the machine, with a DNS record in your router or home DNS server, for example
   `koti.home.arpa` to `192.168.1.10`.
2. Put a reverse proxy in front of the app and give it a certificate from a certificate authority (CA) of your own.
   Caddy does both: it makes its own CA with `tls internal`.

   ```
   koti.home.arpa {
       tls internal
       reverse_proxy 127.0.0.1:8080
   }
   ```

   Another proxy and a CA such as `step-ca` or `mkcert` work as well. Omatalous needs only an https address that
   reaches port 8080 (or your `HOST_PORT`).
3. Trust the CA's root certificate on each device that logs in, phone included: install it as a trusted root in the
   system or browser settings. Without it the browser stops at the bank's return and the page does not open. Keep the
   CA's private key on the machine only.
4. Save `https://koti.home.arpa` under *Asetukset > Palvelin ja ylläpito > Palvelin*. An https address puts the app in
   its own return mode.
5. Add the redirect URL, `https://koti.home.arpa/api/connections/callback`, to your app's Redirect URLs in the Enable
   Banking Control Panel. *Asetukset > Pankit ja tilit* shows it with a copy button.
6. Check it: on a device that trusts the certificate, link a bank. The browser returns to
   `https://koti.home.arpa/api/connections/callback` and the account is linked. A device that does not trust the
   certificate shows the browser's warning there.

The return page of the project (`relay/callback`) stays for plain `http` addresses. An install on a private https name
never uses it.

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
4. Open `https://talous.example.fi` and add the redirect URL under *Asetukset > Palvelin ja ylläpito > Palvelin*,
   `https://talous.example.fi/api/connections/callback`, to your app's Redirect URLs in the Enable Banking Control Panel.
5. Check it: turn Wi-Fi off on the phone and open `https://talous.example.fi`.

The old `http://` address stops working. Login is protected against guessing, see
[SECURITY.md](SECURITY.md#login).

## A second copy on the same machine

You need this when another household should have an Omatalous of their own on your machine, for example your parents,
or when you want a copy to test with.

| | People see |
|---|---|
| A member in your Omatalous (*Asetukset > Jäsenet*) | their own accounts, and the accounts others share with them |
| A second copy | only their own copy, with its own users, data and updates |

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
(see [A clone made by hand](#a-clone-made-by-hand)): it takes the release the first copy runs. Update it later as any copy.

The copy needs its own Enable Banking app, because it makes its own key. The person whose accounts it reads registers it
as in [ENABLE_BANKING.md](ENABLE_BANKING.md).

Run the copy's commands in its own folder, for example `cd ~/isa && ./scripts/update.sh`. Its *Ylläpito* page updates
and backs up only that copy.

To use the copy away from home:

- A VPN to your home covers every copy.
- With your own domain, only one copy can have ports 80 and 443 on an address. A second copy needs another IP address of
  the machine. The installer asks for the address when 80 and 443 are taken.

How the copies are kept apart is in [Settings in .env](#settings-in-env).

## Your own backup

The app makes no backups of your data: you back up the data folder yourself. The data is in two Docker volumes, the
database in `banking-data` and the app secret in `banking-secrets` (`docker volume ls` shows their full names, which start
with the name of the install). The bank keys in the database open only with that secret, so keep the two together.

The app's own copies in `/data/backups` are only its safety before a change (an update, a migration, a reset or a secret
rotation). They sit in the same volume, so they do not help when the disk breaks.

### Copy the data

With the app stopped, so that the database file is whole:

```bash
docker compose stop banking
mkdir -p ~/omatalous-backup
docker run --rm -v <data volume>:/data -v <secrets volume>:/secrets -v ~/omatalous-backup:/out alpine \
  tar czf /out/omatalous-$(date +%F).tgz /data /secrets
docker compose start banking
```

The file holds your transactions and the app secret unencrypted. Keep it on another machine or disk, encrypted, and not
in the same place as the machine.

### Put a copy back, or move to a new machine

1. On a new machine, install Omatalous as [INSTALL.md](INSTALL.md) says, but do not create a user.
2. Stop the app and empty the two volumes, then unpack the file into them:

   ```bash
   docker compose stop banking
   docker run --rm -v <data volume>:/data -v <secrets volume>:/secrets -v ~/omatalous-backup:/in alpine \
     sh -c 'rm -rf /data/* /data/.[!.]* /secrets/* /secrets/.[!.]*; tar xzf /in/omatalous-<date>.tgz -C /'
   docker compose start banking
   ```

3. Log in. On a new machine, set *Sovelluksen osoite* again under *Asetukset > Palvelin ja ylläpito* if the address
   changed.

Without the app secret your users, transactions and settings come back, but the saved bank keys stay locked. Set Enable
Banking up again under *Asetukset > Pankit ja tilit > Pankkisovellus* as [ENABLE_BANKING.md](ENABLE_BANKING.md) says and
connect the accounts again.

### When the database is damaged

If the database fails its check at start, the app changes nothing: every page answers that the database is damaged, and
the log says `database: ... is damaged`. Put back your own copy as above. Without one, the damaged file is still in
`banking-data`, and a `pre-` copy in `/data/backups` may be newer than your own copy.

## Start over

You need this when you want to empty the data, or to delete the install and all its data, for example after testing.

### Empty the data and keep the install

*Asetukset > Palvelin ja ylläpito > Ylläpito > Tyhjennä kaikki tiedot* starts again with an empty database on the same install.

<!-- language-allow: comma-density the list is what the reset deletes, one item each -->
The admin gives
the password and types `TYHJENNÄ`. It deletes every member except the admin who asks, and all accounts, transactions,
rules, marks, loans, expected bills, saving tips, bank keys and bank connections. It keeps that admin's account and
password, the server's settings, the shared bank application and the answers of the trade register about companies.
Payee names the register did not find as a company are deleted. Everyone is signed out.

A copy `pre-reset-<time>.db` is made first in `/data/backups`. To undo the reset, stop the app and put that file in place of
`banking.db` in the data volume, as in [Your own backup](#your-own-backup). It brings the rows back and not the bank
connections, so connect every bank again. The reset ends the bank consents at the bank first, and one that could not be
ended expires there on its own.

The reset removes no copy. Older `pre-` copies and your own backups keep the data
until they are pruned or deleted by hand. What a member saves between the copy and the delete is in neither, so empty
the data when nobody else uses the app. The reset is refused while a bank fetch runs (*Tietojen haku on kesken. Yritä
hetken päästä uudelleen.*) and while another reset runs (*Toinen toiminto on
kesken.*). A wrong word is recorded in the security log as *Ylläpitopyyntö estetty*, detail "tietojen tyhjennys:
vahvistus".

### Delete the install

```bash
./scripts/reset.sh
```

It makes no copy of the data and asks you to type `POISTA` before it deletes anything. It removes the containers, the image of this install,
the data, the app secret, the maintenance helper with its launcher folder and `.env`. The `backups/` folder stays. Install again with `./scripts/install.sh`. With several copies it removes only
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
| `--access lan\|local\|domain` | `TALOUS_ACCESS` | how the app is reached. Default `lan` when the machine has a home network address, else `local` |
| `--bind 192.168.1.10` | `TALOUS_BIND` | for `lan`, the address to listen on |
| `--domain talous.example.fi` | `TALOUS_DOMAIN` | for `domain` |
| `--email you@example.fi` | `TALOUS_EMAIL` | for `domain`, Let's Encrypt notices go there |
| `--port 8080` | `TALOUS_PORT` | the port, default the first free one from 8080 |
| `--name isa` | `TALOUS_NAME` | the copy's name, default the folder name |
| `--no-ops-helper` | `TALOUS_OPS_HELPER=0` | leave the maintenance helper out |
| `--reconfigure` | | show the access menu again on an existing install |

`--domain` with `--email` means `domain`. A run on an
existing install keeps its `.env` unless `--reconfigure` or an answer flag is given. The last lines of the output hold
the address and the setup link.

### A clone made by hand

If you clone the repository yourself and run `./scripts/install.sh` in the clone, the installer asks GitHub once which
release is out. A clone of `main` can sit on the tag of a release that is not out yet. The installer then
says "This folder is at vX.Y.Z, which is not out yet. Installing the latest release,
vY.Z.W.", moves the folder to that release and starts again from there. When GitHub does not answer, it goes on with the
release the folder is at and says so. A folder that already has a `.env` is never asked and never moved.

The pasted install command hands `--install-docker` to the installer, which lets it install Docker with Docker's own
script and `jq`, which the maintenance helper needs. After it adds your user to the `docker` group it carries on in the
same run, with `sg` or, on Ubuntu 26.04.1, which has no `sg`, with `sudo`. With `qrencode` installed
(`sudo apt install qrencode`) the setup link is also shown as a QR code.

## Installed as an app

Over https (your own domain) or at `localhost`, the browser offers to install Omatalous as an app: *Asenna*
in the address bar of Chrome and Edge, *Lisää Koti-valikkoon* on iPhone, *Asenna sovellus* on Android. When the server
cannot be reached, the app then opens the first page with the figures of the last visit and says when they were
fetched. They stay on the device for one user at a time and go at logout. Over plain http on the home network a browser
offers neither.

## Enable Banking options

The redirect URL to register depends on how the app is reached. *Asetukset > Palvelin ja ylläpito > Palvelin* always shows the right one.

| The app is reached at | Redirect URL |
|---|---|
| A home network address (the default) | `https://jouni-mikkola.github.io/omatalous/callback/`, the project's return page. It sends the browser on to your own address, and only to private addresses. |
| Your own https address | `https://<address>/api/connections/callback` |
| An install made before the return page, until you press *Ota käyttöön* | `https://localhost/api/connections/callback`. The bank then shows an error page, and you paste its address into the app. |

To let Enable Banking make the key in the browser instead, choose *Generate in the browser* when you register the app and
upload the downloaded `.pem` file under *Muut vaihtoehdot > Minulla on .pem-tiedosto*. Delete the file afterwards.

### A member's own app

A member can use an Enable Banking app of their own for their own connections.
*Asetukset > Pankit ja tilit > Pankkisovellus* has the choice *Talouden sovellus* or *Oma sovellus*. A member of a household with no shared app has the own app only.
The member registers it like the household's app, with their own Enable Banking account, with these differences:

- Omatalous makes no key for a member. Choose *Generate in the browser* for the private key. Enable Banking then
  downloads a `.pem` file.
- *Oma sovellus* shows the redirect URL, the privacy URL and the terms URL, each with a copy
  button.
- Link the member's accounts in their app, as in [Connecting a bank](ENABLE_BANKING.md#the-steps).

Save the Application ID and the `.pem` file under *Pankkisovellus* > *Oma sovellus* with *Tallenna ja testaa*,
then delete the file from the downloads folder. The save tests the pair with Enable Banking first. A pair Enable Banking
refuses is not saved, and the key saved before stays. Any other answer, *Inactive* included, saves the key and shows
what the test said. The key is stored encrypted. *Poista oma avain* returns the member to the household's app.

A bank consent belongs to the app that made it, and only that app can end it. While the member has an active
connection, *Poista oma avain* and a save with another Application ID are refused, and the message names the
connections. Remove the connections first, then change the app. A new key for the same Application ID, and a
member whose connections are all `revoked` or `expired`, are not held back.

## The maintenance helper

You need this when *Asetukset > Palvelin ja ylläpito > Ylläpito* says "Ylläpitoapuri ei ole käytössä" or that the helper is out of date. The
buttons on that page work through a small helper on the machine, which the installer sets up. To set it up again:

```bash
./scripts/install.sh --ops-helper
```

It needs a normal user, never root, and `jq`. It starts once a minute from a systemd user timer, or from cron where a timer
cannot keep running, and then waits for a press for most of that minute, so a request starts within seconds. `./scripts/install.sh --ops-helper-off` removes it.

The app only writes a request. The helper checks it against a fixed list of twelve actions (check for updates, update, roll
back, back up, restart, check the install, read the logs, free disk space, renew itself, change how the copy is
reached, and turn the switch for new versions on or off, see [Updates in detail](#updates-in-detail)) and runs one of
the project's own scripts. Nothing from the database reaches a shell, and the port is never
changed from the browser. None of them takes a parameter. The logs are the last 100 lines of each running service with keys and tokens hidden. Freeing
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
vastannut 10 minuuttiin*. The hourly check does not offer the version that was taken back until a day has passed (*Tarkista päivitykset* shows it at once). When the rollback
does not bring the app back, `ops/RECOVERY.txt` has the commands to run by hand, and the helper does not try again.

#### The address

In the home network mode the helper follows the machine to a new address. It acts when the address in `BIND_ADDRESS`
has been gone from the machine for ten minutes and the network interface that had it has exactly one private address
now (10/8, 172.16/12 or 192.168/16). It then writes the new address to `.env` (and to `APP_BASE_URL` when that was the
installer's own `http://` address), starts the app on it, and does so at most once an hour. The app restarts once.
`ops/helper.log` and the journal (`journalctl --user -u talous-ops-<name>`) get one line that tells the new address,
"Osoite vaihtui: http://10.0.0.5:8080". *Asetukset > Palvelin ja ylläpito > Palvelin* may still show the old address. A reservation of the
address in the router remains the better advice.

It follows only the interface that had the address, and never a tunnel or a point-to-point link such as a VPN. It does
nothing with Caddy, and without the helper (`--ops-helper-off`) nothing follows, so
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
app's old images; now M MB free"). It never touches a volume (the data and its copies), the running version, the
previous version or the tagged images of other software. A release image arrives with a registry tag. The update reads
the image's id right after the pull and tags the image `:latest` by that id, then removes the registry tag, so that an old
version is untagged and the cleaning can free it, so it frees every older image and leaves the running version and the
previous one. *Siivoa levy* ("Poistaa vanhat versiot ja välimuistin.") is unchanged and also removes the build cache.

#### Files in ops/

Beside the journal and `RECOVERY.txt`: `watchdog-since`, `watchdog-<AT>` and `watchdog.frag` (the watchdog's count, a
settled update and its report), `address-if`, `address-since`, `address-at`, `address-doing` and `run/address.log` (the
address follow-up, which also writes `env.prev` and `env.written`), `housekeeping-at` (the time of the last cleaning
try), `last-check` (the daily round: doctor and cleaning), `last-hourly` (the version check, once an hour) and
`taken-back` (the version the watchdog took back, and when). Leave them alone.

## Updates in detail

An update pulls the signed image from `ghcr.io` and checks its signature against the project's release workflow. It
copies the database before the new version starts, and goes back by itself if the new version does not start.
`./scripts/update.sh --yes` does the same from cron.

The Caddy image in `docker-compose.yml` is pinned to a release and its digest, so an install pulls the image that was tested. The maintenance helper of an install updated before the pin takes only `caddy:2` and refuses the new file, so that install updates once from the command line: in its folder run `git fetch origin && git checkout -B main origin/main && ./scripts/update.sh`. The same command is in [TROUBLESHOOTING.md](TROUBLESHOOTING.md#updates).

Two copies of Omatalous on one machine may fetch the same version at the same moment, and the one that finishes first
removes the registry tag of the image. The other update then pulls the image once more and goes on. If the tag is gone
again after that second pull, the update stops and the old version keeps running. When the script asks GitHub which
release is out and GitHub answers 403 or 429, the limit of requests for the address was met (60 an hour without a
token). `./scripts/update.sh` run by hand then says "GitHub turned the request down: the limit of requests for this
address was met. Nothing was changed. Wait an hour and run this again." It does not try again.

The five newest copies taken before an update stay, and the one the next `--rollback` needs is never deleted, however
long ago it was taken. The copies before a migration (five newest), a reset and a secret rotation (14 days each) have
their own rules, so one kind never pushes out another. Nothing is deleted while the database fails its check. If the
database fails its check when a rollback has to put a copy back, the rollback moves the damaged file aside as
`damaged-<time>.db` in `/data/backups` first and never writes over it. See [The app's own copies](#the-apps-own-copies).

Before the old version stops, the update tries the new version's database changes on that copy, in a separate
container (`node dist/node.js migrate-check`, which needs room for about twice the database in the data volume). If the
check fails, the update stops with exit code 3 and the old version keeps running, with nothing changed. If the check
could not run at all (a Docker error, no memory), the exit code is 4 and nothing is known about the migrations. The check
is skipped when the new image does not have the command. How long the check took sets how long the new version may take
to start: three times that, at least two minutes and at most 15, and never beyond the time the maintenance helper has
left for the update. The update records whether it changed the database structure, and *Asetukset > Palvelin ja ylläpito > Ylläpito* warns
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

An install follows the latest release GitHub names. The hourly check, *Päivitä* and `./scripts/update.sh` offer a
release as soon as it is published, and nothing installs by itself. An install that is already on a version above the
latest release stays there, and `update.sh` says "Already on vX.Y.Z, newer than the latest release (vY). Nothing was
changed." The project holds a release back by making it a draft, and pulls one by deleting it; neither is seen as the
latest. An install of 0.8.x that is updated by hand with `./scripts/update.sh` takes the newest tag, because the script of
0.8.x does.

`TALOUS_CHANNEL` in `.env` chooses where updates come from. Without it, an install follows the signed releases and
builds from source only when its checkout is newer than the latest release. `release` always follows the releases and
`source` always builds the newest source on the machine. The next update uses the new value.

`TALOUS_SOURCE_CHECKED=yes` beside `TALOUS_CHANNEL=source` makes a source install wait for GitHub's checks. An update
then takes the newest commit of the branch for which the workflows `check` and `privacy` passed, and stays where it is
while none has. A commit that changes documents alone starts no run of `check` and counts as checked when the commit
before it does. `update.sh` and the Päivitä button both ask GitHub once per update, with no key (60 questions an hour
for one address). When GitHub does not answer, nothing changes. The default is `no`.

## Commands

| To | Run |
|---|---|
| Check the install | `./scripts/doctor.sh` |
| Test the maintenance helper, as your normal user | `./scripts/ops-helper.sh --self-test` |
| Update | `./scripts/update.sh` |
| Go back to the previous version | `./scripts/update.sh --rollback` |
| Change how the app is reached | `./scripts/install.sh --reconfigure` |
| Follow the log | `docker compose logs -f banking` |
| Show the version | `docker compose exec banking node dist/node.js version` |
| Get a new setup code, before the first user exists (a generated code works for 24 hours) | `docker compose exec banking node dist/node.js setup-code` |
| Reset a password | `docker compose exec banking node dist/node.js user reset-password <username>` |
| Take a second sign-in factor away (the phone and the recovery codes are lost; the user is signed out and told) | `docker compose exec banking node dist/node.js user remove-factor <username>` |
| Sign everyone out | `docker compose exec banking node dist/node.js sessions revoke-all` |
| Give a script or an agent read access (see below) | `docker compose exec banking node dist/node.js service-token create <username> --name <name> [--days 1-90]` |
| List or remove service tokens | `docker compose exec banking node dist/node.js service-token list`, `service-token revoke <id>` or `revoke --all` |
| Stop or start | `docker compose stop`, `docker compose up -d` |
| Replace the app secret | `docker compose exec banking node dist/node.js secret rotate`, then `docker compose restart banking` |

Replace the app secret only with `secret rotate`. It copies the database, seals every saved bank key again under the new
secret and keeps the old one as `app_secret.prev-<time>` in the secrets volume. Delete that file after 14 days, when the
copies made before the rotation are gone.

### Service tokens

A service token lets a script or a coding agent read one user's data without a password or a session. It is made on the
command line, so only someone on the host can make one:

```bash
docker compose exec banking node dist/node.js service-token create <username> --name claude --days 14
```

The command prints the token once (`omt_` and 43 characters). The app keeps only its SHA-256. The program sends it as a
header on each request:

```bash
curl -H "Authorization: Bearer omt_..." http://<address>/api/dashboard
```

What a token can do:

- It reads as its user with a member's rights, also when the user is an admin.
- It only reads, and only the routes of the data pages (`READABLE` in `apps/server/src/services/service-tokens.ts`).
  Sign-in, sessions, the security log, the admin and maintenance routes, the bank's callback and the exports answer
  403. A route added later stays shut until it is named there.
- A request with a token is answered by the token alone. A session cookie beside it is not read.
- It ends after 30 days unless `--days` says otherwise (at most 90), and goes with its user.
- Its first use in each hour is a security event with the address. The user it reads as gets a notice when it is made.
- 20 unknown tokens from one address in 15 minutes stop that address for the rest of the window.

An admin sees the tokens as rows of the list under *Asetukset > Turvallisuus > Omat istunnot* (the card is named *Istunnot ja palvelutunnukset* while a token exists) and removes one there with *Poista tunnus*. Give an
agent a token of a user made for it when it should not read the household's real data.

## Settings in .env

The installer writes `.env`. You rarely need to change it by hand. After a change, run `docker compose up -d`.

A new home network address changes `.env` after the first install. It is written as a whole new
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
| `TALOUS_SOURCE_CHECKED` | `yes` or `no` (default `no`). `yes` makes a source install take only a commit whose checks passed on GitHub (see [Updates in detail](#updates-in-detail)). It stays over a re-run and `--reconfigure`. |
| `TRUST_PROXY` | `true` behind Caddy, so the app sees each visitor's own address. The installer sets it. |
| `ACCESS_LAN_BIND` | left by an earlier release: the address the port had before remote access moved it to `127.0.0.1`. Nothing reads it now, and the installer keeps it as it is. |

Never change `COMPOSE_PROJECT_NAME` of a copy that has data. The data stays in the volumes of the old name and the copy
starts empty. Changing `INSTANCE_NAME` signs everyone out. An install made before copies existed keeps the old names,
`banking-app`, whatever its folder is called.

The database lives in the volume `<name>_banking-data`, and `<name>_banking-secrets` holds the key that opens the saved
bank keys. Both survive restarts, updates and image rebuilds. Only `./scripts/reset.sh` and `docker compose down -v`
delete them.

### Limits

The numeric limits come from one schema, `apps/server/src/platform/limits.ts`: a key, a type, a default, a minimum, a
maximum and whether a change needs a restart. A value has three layers. The default is what the code always used. A key
in `.env` replaces it, and a value an admin saves replaces both. A value outside the minimum and maximum is not used: the
environment falls back to the default with a warning, and the API answers 400.

| Key in `.env` | Limit (default) |
|---|---|
| `LOGIN_IP_LIMIT`, `LOGIN_USER_LIMIT`, `LOGIN_NAME_LIMIT` | failed sign-ins per address (50), per name and address (10) and per name (30) in one window |
| `AUTH_WINDOW_MINUTES` | the window of the sign-in, password, second factor, setup, service token, maintenance and Access limits (15) |
| `PASSWORD_CHANGE_LIMIT`, `FACTOR_USER_LIMIT`, `FACTOR_NAME_LIMIT`, `SETUP_LIMIT`, `SERVICE_TOKEN_LIMIT`, `OPS_LIMIT`, `ACCESS_FAILURE_LIMIT` | tries per window (5, 5, 15, 10, 20, 5, 10) |
| `KEY_TEST_LIMIT`, `KEY_TEST_WINDOW_MINUTES` | tests of a bank key per window (8 in 10 minutes) |
| `REQUEST_MAX_KB` | the largest request body (256 kB) |
| `HASH_SLOTS` | password hashes running at once (4) |
| `PASSWORD_MEMORY_KIB`, `PASSWORD_PASSES` | Argon2id memory in KiB (19456, up to 32768) and passes (2, up to 10) of a new password hash. Memory is held by each running hash, so `HASH_SLOTS` times memory is what a burst of sign-ins takes (4 times 19 MiB is 76 MiB of the 512 MiB the container may use). A hash made earlier keeps its own cost until the next sign-in rewrites it |
| `EB_CONSENT_DAYS`, `HISTORY_DAYS` | the length of a bank consent (180) and of the history fetched (730) |

An admin reads them with `GET /api/admin/limits` and changes them with `PUT /api/admin/limits`, which takes a partial
object of keys (`loginUser`, `requestKb`, ...) and `null` to give a value back to the layers below. A change holds from
the next request with no restart, and each change is a security event (`limits_changed`) with the old and new value. A window already running keeps the end it had; the new length applies to the next one.
The `.env` keys reach the app only if `docker-compose.yml` passes them on, so in Docker use the admin API.
The history depth is kept in the instance settings of *Asetukset > Palvelin ja ylläpito > Palvelin* and follows the same minimum and maximum.
