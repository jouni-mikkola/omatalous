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

The tables below list the usual cases. Messages from the scripts are in English, the app's in Finnish.

## During the install

Pasting the install command from [step 1 of the install guide](INSTALL.md#1-get-omatalous) again after a fix is always
safe, and so is `./scripts/install.sh` in the folder `~/omatalous`. It continues where it stopped. If you gave `--dir` or
`--new-instance` the first time, paste the command with the same option, or it starts another install in `~/omatalous`.

| What you see | What to do |
|---|---|
| `curl: command not found` | Run `sudo apt update && sudo apt install -y curl`, then paste the install command again. |
| `omatalous-install.sh: FAILED` and "computed checksum did NOT match" | The downloaded file differs from the hash in the command, so nothing ran. The page can take ten minutes to update after a release: wait, then paste the command again. If it fails again, do not run the file, and report it as [SECURITY.md](../SECURITY.md) says. |
| "Run this as your normal user, not as root" | Log in as your normal user and paste the command again. The installer asks for `sudo` when it needs it. |
| `git: command not found` or "git is missing" | The script offers to install git. If you said no, run `sudo apt update && sudo apt install -y git`, then paste the install command again. |
| "Omatalous has no release yet", "GitHub did not answer" or "GitHub answered with HTTP ..." | Wait a few minutes and paste the command again. The message also prints the commands that install without the script. |
| "... is not a clone of Omatalous" | The folder (`~/omatalous` unless you gave `--dir`) holds something else, and the script leaves it alone. Add `--dir FOLDER` with a new folder to the end of the command. |
| "... is not on the main branch" | The newest release is not part of the project's main branch, so the script refused it and installed nothing. Do not install it by hand, and report it as [SECURITY.md](../SECURITY.md) says. |
| "Docker is missing" or `docker: command not found` | Run `./scripts/install.sh --install-docker`. It installs Docker and carries on with the install. |
| "Your user has no access to Docker" or `permission denied ... docker.sock` | Close the SSH connection and open it again (or log out and in on the machine itself), then paste the install command again. The installer gave your user the Docker right, and a new login makes it take effect. The installer tries to carry on in a new session by itself first, with `sg` or, where that is missing (Ubuntu 26.04.1), with `sudo`. |
| "Make it now with ./scripts/cloudflare-setup.sh?" | Choice 3 (Cloudflare Tunnel) found no settings file. Answer `y` and the installer runs that script: it asks for an API token (the installer shows where the token is made and which permissions it needs), the domain and the emails Access lets in. If you answer `n` or the script fails, the installer asks for a tunnel token from the Cloudflare dashboard instead. |
| No QR code under the setup link | Install `qrencode` (`sudo apt install qrencode`) and run `./scripts/install.sh` again. The installer never installs it by itself. |
| "Only ... MB free on the disk" or "The disk filled up during the build" | Free disk space with `docker image prune -f && docker builder prune -f`, then run the installer again. |
| The build stops and the machine has less than 2 GB of memory | Give the machine more memory, then run the installer again. |
| "The build had no network connection" | The machine cannot reach the internet. Check that `curl -I https://registry.npmjs.org` answers, then run the installer again. |
| "Docker Hub limits pulls from this address" | Wait an hour, then run the installer again. |
| "Port 8080 is already in use" | Another program uses the port. Run `./scripts/install.sh --port 8085`. |
| "Another install or update is already running in this folder" | Another install or update runs in the same folder. Wait until it ends. |
| "Maintenance helper: off (...)" on the last line | The reason is in the brackets. Fix it, then run `./scripts/install.sh --ops-helper`. If the install ran as root, run it again as your normal user. |
| "Maintenance helper: not working yet, run: sudo systemctl restart user@...service" on the last line | The systemd user manager started before your user joined the docker group, so the timer cannot reach Docker. Run the command it prints, or reboot. Nothing else is needed. |
| "Maintenance helper: on (cron, because the systemd user manager does not have the docker group yet)" | It works, and cron keeps running it after a reboot. To move it to the systemd timer, run `./scripts/install.sh --ops-helper` after a reboot; nothing needs it. |

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
| The browser stays on the `github.io` page or shows an error after the bank login | Use a device on your home Wi-Fi and try again. If it still fails, copy the whole address from the browser's address bar and paste it under *Asetukset > Pankkiyhteydet > Paluusivu ei auennut?*. |
| A message that names Enable Banking, or an account or a card that is missing | The messages and what they mean are in [Errors](ENABLE_BANKING.md#errors). |
| "Liian monta testiä peräkkäin. Odota muutama minuutti." | A test of an Enable Banking key or Application ID sends a request to Enable Banking, so a member can run eight in ten minutes and the admin's checks share eight for the whole copy. Wait and try again. |
| A bank is missing from the list of *Lisää pankkiyhteys* | The list shows the banks your Enable Banking app offers. Check the app under *Asetukset > Palvelin*, see [Choosing a bank](ENABLE_BANKING.md#choosing-a-bank). |

## Updates

| What you see | What to do |
|---|---|
| The app keeps restarting and the log says "The database was upgraded by a newer app version" | The database is from a newer version than the app. Run `./scripts/update.sh`. |
| An update and its rollback both failed | Follow the commands in `ops/RECOVERY.txt`. |
| "The database changes of the new version failed on a copy of your data" (in the browser: "Uuden version tietokantamuutokset epäonnistuivat kopiolla") | The update stopped before anything was changed. The old version is still running and your data is as it was. Try again after the next release. If it repeats, report it with the output of `./scripts/doctor.sh`. |
| "The migration check could not run" (in the browser: "Tietokantamuutosten tarkistusta ei voitu ajaa") | The check of the new version's database changes did not start or was killed, for example by a Docker error or too little memory or disk. Nothing was changed and the old version is still running. Free memory or disk space (`df -h`, `docker image prune -f`) and run the update again. |
| "The database copy from before the update ... is missing or damaged" | A rollback checks its copy before it stops anything, so the app is still running. Restore an older copy by hand as in [ADVANCED.md](ADVANCED.md#restore-a-backup). |
| After a rollback, what was written since the update is gone | The previous version could not read the updated database, so the rollback put back the copy from before the update. That happens when it refused the database, when it is 0.5.x or older, when the check took too long and when Docker failed. A rollback to 0.6.0 or later keeps the data when every newer migration has a compat floor at or below the previous version. The database as it was right before the rollback is saved as `pre-rollback-*.db` in `/data/backups`. Update again with `./scripts/update.sh`, then restore that copy as in [ADVANCED.md](ADVANCED.md#restore-a-backup). |
| *Asetukset > Ylläpito* says "Ylläpitoapuri ei ole käytössä" or that the helper is out of date | Run `./scripts/install.sh --ops-helper`. |

## Away from home and second copies

| What you see | What to do |
|---|---|
| Your own domain has no certificate | Check that the DNS record points to your public address and that ports 80 and 443 are forwarded to the machine, then read `docker compose logs caddy`. |
| The Cloudflare address shows an error page | Read `docker compose logs tunnel`. Check that the tunnel's service is `http://banking:8080`. |
| Every page answers "Pääsy estetty." | The app checks the Cloudflare Access token itself and refuses a request without a valid one. Open the app at its Cloudflare address, not at the home address or `http://localhost:<port>`, which are closed once the check is on. If the Cloudflare address answers it too, `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` in `.env` is wrong. Fix it, or remove both lines and run `docker compose up -d`. Ten failed checks from one address within 15 minutes also close that address for the rest of the window. |
| After turning on remote access the home address no longer opens | That is meant. Open `https://<the address>` and sign in through Cloudflare. If nobody gets in within 15 minutes, the server takes the address off by itself and the home address works again, and *Asetukset > Turvallisuus* shows "Etäkäyttö poistettu, koska kukaan ei päässyt sisään". Check the address and that your email is on the list, then turn it on again. |
| Remote access is on and the page cannot be opened | Run `./scripts/install.sh --reconfigure` on the machine and choose another way in. The helper's copy of the `.env` from before its last change is `ops/env.prev`. |
| The Etäkäyttö page says the helper is missing or out of date | Run `./scripts/install.sh --ops-helper` on the machine. |
| `secret rotate` stops and names the Cloudflare API token | The token saved on the Etäkäyttö page cannot be opened with the current secret, so it cannot be sealed again. Nothing was changed. Remove the token on the page, run the rotation again and save the token afterwards. |
| A second copy does not start | Run its own `./scripts/doctor.sh` in its folder, for example `cd ~/isa`. |
| A backup is missing from `backups/` | Read `backups/backup.log` and check the cron line with `crontab -l`. |
| `backup.log` says a file "is a link, so ... was not copied" | The copy to the NAS never writes through a link on the share. Someone put a link where the backup would go. Remove it from the share. The backup itself is in `backups/`. |
| `restore.sh` says a file "does not open the saved bank keys of this database" | The `--secret` file is not the app secret of that backup, for example another copy's. The database was restored and the current app secret stays, so the saved bank keys stay locked. Run the restore again with the right `.app_secret.age` file, see [Restore a backup](ADVANCED.md#restore-a-backup). |

## Loans

| What you see | What to do |
|---|---|
| "PDF on suojattu salasanalla. Liitä lainasta kuvakaappaus tai teksti." | The reader cannot open a PDF that has a password. Paste a screenshot or the text of the loan instead. |
| "PDF-tiedostossa on pelkkä kuva. Ota siitä kuvakaappaus ja liitä se." | The PDF holds a picture and no text. Take a screenshot of it and paste that. |
| "Kuva on liian suuri, yli 40 miljoonaa pikseliä. Ota lainan tiedoista kuvakaappaus." or "Tiedosto on liian suuri. Ota lainan tiedoista kuvakaappaus." | The file is refused before it is opened, so a huge file cannot fill the phone's memory. A screenshot of the loan page is small enough. |
| "Lukeminen ei edennyt, joten se keskeytettiin. Yritä uudelleen tai liitä lainan tiedot tekstinä." | The reading made no progress for two minutes. Try again, or copy the loan's text from the bank's page and paste it. *Keskeytä* ends a reading earlier. |
| The first picture takes a while | The picture reader, about 11 MB with its Finnish and English data, is fetched from the app the first time a picture arrives. It is read in the browser and nothing is sent. |
| *Tallenna* does not work | A field marked *Tarkista* is outlined. Tick it as right, or correct it. Everything read from a picture is *Tarkista*. |
| The debt appears twice in *Lainat* | A saved loan cannot yet be tied to a connected card or loan account. When both may be the same debt, both are counted and *Lainat* says so. Removing the saved loan fixes it. |
