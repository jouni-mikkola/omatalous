# Troubleshooting

## Start here

Log in to the machine and go to the Omatalous folder. If a command below says permission denied, log out, log in again
and retry:

```bash
cd ~/omatalous
```

1. Check the install. In the app, open *Asetukset > Ylläpito* and press *Tarkista järjestelmä*. If the app does not
   open at all, run `./scripts/doctor.sh` on the machine instead. Both name the problem and the command that fixes it.
2. Restart the app with *Käynnistä sovellus uudelleen*, or `docker compose restart banking`.
3. If the trouble began with an update, press *Palauta edellinen versio*, or run `./scripts/update.sh --rollback`.
4. Read the end of the log with `docker compose logs --tail 100 banking`.

If none of that helps, [restore a backup](ADVANCED.md#restore-a-backup) or [start over](ADVANCED.md#start-over).

The tables below list the usual cases. Messages from the scripts and the app are in Finnish.

## During the install

Running `./scripts/install.sh` again after a fix is always safe. It continues where it stopped.

| What you see | What to do |
|---|---|
| `git: command not found` or `docker: command not found` | Do [step 1 of the install guide](INSTALL.md#1-install-docker), then run the installer again. |
| "Your user has no access to Docker" or `permission denied ... docker.sock` | Type `exit`, log in again and run the installer again. Logging in again gives your user the Docker right from [step 1](INSTALL.md#1-install-docker). |
| "Only ... MB free on the disk" or "The disk filled up during the build" | Free disk space with `docker image prune -f && docker builder prune -f`, then run the installer again. |
| The build stops and the machine has less than 2 GB of memory | Give the machine more memory, then run the installer again. |
| "The build had no network connection" | The machine cannot reach the internet. Check that `curl -I https://registry.npmjs.org` answers, then run the installer again. |
| "Docker Hub limits pulls from this address" | Wait an hour, then run the installer again. |
| "Port 8080 is already in use" | Another program uses the port. Run `./scripts/install.sh --port 8085`. |
| "Another install or update is already running in this folder" | Another install or update runs in the same folder. Wait until it ends. |
| "Maintenance helper: off (...)" on the last line | The reason is in the brackets. Fix it, then run `./scripts/install.sh --ops-helper`. If the install ran as root, run it again as your normal user. |

## Opening the app

| What you see | What to do |
|---|---|
| The address does not open on a phone | The phone must be on your home Wi-Fi, not on a guest network. A virtual machine needs a bridged network adapter. |
| The address stopped working after the machine or the router restarted | The machine got a new address. Run `./scripts/install.sh --bind <new address>`, using the address `hostname -I` prints. The installer saves it in the app too. Then reserve it in the router as [INSTALL.md](INSTALL.md#after-the-install) says. |
| You lost the setup link before creating the first user | Run `./scripts/install.sh` again. It prints a new link. |
| You forgot your password | Another admin can press *Nollaa salasana* under *Asetukset > Talouden jäsenet*. If you are the only admin, run `docker compose exec banking node dist/node.js user reset-password <username>`. It prints a temporary password. |
| Login does not stay on an https address | Use the address shown under *Asetukset > Palvelin*. |

## Connecting the bank

| What you see | What to do |
|---|---|
| The browser stays on the `github.io` page or shows an error after the Nordea login | Use a device on your home Wi-Fi and try again. If it still fails, copy the whole address from the browser's address bar and paste it under *Asetukset > Pankkiyhteydet > Paluusivu ei auennut?*. |
| "Enable Banking ei hyväksy paluuosoitetta" | Add the address the message names to your app's Redirect URLs in the Enable Banking Control Panel. |
| "Enable Banking hylkäsi avaimen (401)" | The Application ID is not copied in full, or the certificate in Enable Banking is not the one Omatalous made. Check both and press *Tallenna ja testaa* again. |
| "Enable Banking hylkäsi avaimen (403)" | The app is still *Inactive*, or no account is linked. Do step 3 of [ENABLE_BANKING.md](ENABLE_BANKING.md#3-link-your-accounts). |
| An account or a card is missing | Link it in the Enable Banking Control Panel with *Link accounts*, then add it in Omatalous with *Lisää seuraava tili*. |

## Updates

| What you see | What to do |
|---|---|
| The app keeps restarting and the log says "The database was upgraded by a newer app version" | The database is from a newer version than the app. Run `./scripts/update.sh`. |
| An update and its rollback both failed | Follow the commands in `ops/RECOVERY.txt`. |
| *Asetukset > Ylläpito* says "Ylläpitoapuri ei ole käytössä" or that the helper is out of date | Run `./scripts/install.sh --ops-helper`. |

## Away from home and second copies

| What you see | What to do |
|---|---|
| Your own domain has no certificate | Check that the DNS record points to your public address and that ports 80 and 443 are forwarded to the machine, then read `docker compose logs caddy`. |
| The Cloudflare address shows an error page | Read `docker compose logs tunnel`. Check that the tunnel's service is `http://banking:8080`. |
| A second copy does not start | Run its own `./scripts/doctor.sh` in its folder, for example `cd ~/isa`. |
| A backup is missing from `backups/` | Read `backups/backup.log` and check the cron line with `crontab -l`. |
