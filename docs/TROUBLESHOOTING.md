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
3. If the trouble began with an update, press *Palauta edellinen versio*, or run `./scripts/update.sh --rollback`. The
   maintenance helper does this by itself when the app has not answered for ten minutes within an hour of an update,
   see [the watchdog](ADVANCED.md#the-watchdog).
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
| "Another install or update is already running in this folder" | Another install, update, restore or reset runs in the same folder; the lock is the folder itself, and it holds until that run ends, also after the run has replaced `scripts/install.sh`. The maintenance helper's address change, cleaning of old images and watchdog wait for the same lock. Wait until it ends. Run the scripts as the user who owns the folder: a run by another user, for example with `sudo`, is not seen by the lock's look at old holders. |
| "Maintenance helper: off (...)" on the last line | The reason is in the brackets. Fix it, then run `./scripts/install.sh --ops-helper`. If the install ran as root, run it again as your normal user. |
| "Maintenance helper: not working yet, run: sudo systemctl restart user@...service" on the last line | The systemd user manager started before your user joined the docker group, so the timer cannot reach Docker. Run the command it prints, or reboot. Nothing else is needed. |
| "Maintenance helper: on (cron, because the systemd user manager does not have the docker group yet)" | It works, and cron keeps running it after a reboot. To move it to the systemd timer, run `./scripts/install.sh --ops-helper` after a reboot; nothing needs it. |

## Opening the app

| What you see | What to do |
|---|---|
| The address does not open on a phone | The phone must be on your home Wi-Fi, not on a guest network. A virtual machine needs a bridged network adapter. |
| The address stopped working after the machine or the router restarted | The machine got a new address. With the maintenance helper on, the app moves to the new address by itself after ten minutes, and `ops/helper.log` has the line "Osoite vaihtui: http://...". [ADVANCED.md](ADVANCED.md#the-address) says when it does not follow. Then run `./scripts/install.sh --bind <new address>`, using the address `hostname -I` prints. The installer saves it in the app too. Then reserve it in the router as [INSTALL.md](INSTALL.md#after-the-install) says. |
| You lost the setup link before creating the first user | Run `./scripts/install.sh` again. It prints a new link. |
| "Väärä asennuskoodi." or "Asennuskoodi on vanhentunut." on the setup page | A generated setup code works for 24 hours. Run `docker compose exec banking node dist/node.js setup-code` in the install folder (a second copy's own folder for a second copy). It prints a new code. A `SETUP_CODE` kept in `.env` never expires, and the command prints that code. |
| You forgot your password | Another admin can press *Nollaa salasana* under *Asetukset > Talouden jäsenet*. If you are the only admin, run `docker compose exec banking node dist/node.js user reset-password <username>`. It prints a temporary password. |
| Login does not stay on an https address | Use the address shown under *Asetukset > Palvelin*. |

## Connecting the bank

| What you see | What to do |
|---|---|
| The browser stays on the `github.io` page or shows an error after the bank login | Use a device on your home Wi-Fi and try again. If it still fails, copy the whole address from the browser's address bar and paste it under *Asetukset > Pankkiyhteydet*, in the line *Viimeistele yhteys osoitteella*, which reads *Liitä pankin viimeisen sivun osoite* on an install that ends on the bank's error page. Then press *Viimeistele*. |
| A message that names Enable Banking, or an account or a card that is missing | The messages and what they mean are in [Errors](ENABLE_BANKING.md#errors). |
| "Liian monta testiä peräkkäin. Odota muutama minuutti." | A test of an Enable Banking key or Application ID sends a request to Enable Banking, so a member can run eight in ten minutes and the admin's checks share eight for the whole copy. Wait and try again. |
| You look for the import of Nordea CSV files | It was removed in 0.9.0. Transactions come only through a bank connection, see [INSTALL.md](INSTALL.md#4-connect-a-bank). An account that an older version made from CSV files stays with its rows, and when you connect the same account through the bank, the rows move into the bank's account. |
| A bank is missing from the list of *Yhdistä pankki* | The list shows the banks your Enable Banking app offers. Check the app under *Asetukset > Palvelin*, see [Choosing a bank](ENABLE_BANKING.md#choosing-a-bank). |

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
| "Edellinen versio palautettiin, koska sovellus ei vastannut 10 minuuttiin" | The new version did not answer for ten minutes, so the helper took the update back by itself, once. The app's last 60 log lines from before are in `ops/run/watchdog-<AT>.log` and `ops/helper.log` has lines that start with `watchdog:`. The daily check offers the version again within a day. To keep a broken version up for debugging, see [the watchdog](ADVANCED.md#the-watchdog). If the app is still down, `ops/RECOVERY.txt` has the commands. |
| "Edellinen versio palautettiin, koska uusi ylläpitoapuri ei toiminut" | The update brought a maintenance helper that failed its self-test, so the update was taken back at once. `./scripts/ops-helper.sh --self-test` prints the reason. Try again after the next release, and report it with that output if it repeats. |
| "Päivitetty: ..., mutta uusi ylläpitoapuri ei toimi (...). Päivitystä ei palautettu, koska tuoretta varmuuskopiota ei ole." | The new version runs and its helper does not. There was no copy from the last hour to go back to, so the update stays. Repair the helper on the machine using the reason in the message. `./scripts/update.sh --rollback` still goes back. |
| `ops/helper.log` has "launcher: the helper of this folder cannot be run (...)" | The clone's helper is broken, for example after an update that went wrong. The last good copy runs for it, so the page still works. Press *Päivitä* or *Palauta edellinen versio*, or run `./scripts/update.sh`. `./scripts/doctor.sh` warns too, and `cat ~/.local/share/omatalous/<name>/.note` shows the reason. When the line also says that the last good copy is damaged or cannot be run, nothing runs: run `./scripts/update.sh`, then `./scripts/install.sh --ops-helper`. |
| "Already on vX.Y.Z, newer than the latest release (vY)." | The install runs a release that is still a pre-release, and `update.sh` changed nothing. Wait until it is promoted, or turn on *Tarjoa uudet versiot heti* under *Asetukset > Ylläpito* (without the helper, set `TALOUS_PRERELEASE=yes` in `.env`), see [Updates in detail](ADVANCED.md#updates-in-detail). |
| "Could not ask GitHub for the latest release. Nothing was changed." | `update.sh` by hand could not reach `api.github.com`, or GitHub limited it (60 requests an hour per address without a token). Try again later, or check `curl -I https://api.github.com`. It also appears when GitHub lists no release while the folder has release tags. |
| "TALOUS_PRERELEASE in .env is invalid. Allowed: yes, no." (in `ops/helper.log`: ".env is invalid: TALOUS_PRERELEASE is invalid") | Fix the line in `.env` or remove it. The helper does nothing until `.env` is valid, so the switch *Tarjoa uudet versiot heti* cannot fix it: a request made meanwhile ends as *Vanhentui* after ten minutes. |
| "Tiedostoa .env ei voitu kirjoittaa. Mitään ei muutettu." after a click on *Tarjoa uudet versiot heti* | The helper could not put a new `.env` in place of the old one, and `.env` is as it was. Look at `ls -l .env` in the install folder: the owner must be the user who runs the helper, and the group one of that user's own groups. After `sudo chown user .env` the group is often still `root`, and the helper does not take on a group it is not in. Set both with `sudo chown "$USER:$(id -gn)" .env`, and check that the folder itself is writable for that user. |
| "Asetus kirjoitettiin tiedostoon .env, mutta apuri ei saa sitä sieltä luettua." | The line `TALOUS_PRERELEASE` is in `.env`, but the daily check reads nothing from the file, for example because it holds a stray byte that is no text (`cat -v .env` shows it as `^@`). Remove the odd characters in an editor and press the switch again. |
| "Release vX.Y.Z is not in this folder." | GitHub names a tag that `git fetch --tags` has not brought. Check the network, run `git fetch --tags` and try again. |

## The database, the copies and the disk

| What you see | What to do |
|---|---|
| The notice "Tietokanta on vaurioitunut, eikä ehjää varmuuskopiota löytynyt." | The database failed its check and the data volume holds no intact copy. The app runs on the damaged file. Put a copy you kept elsewhere on the machine and restore it, see [Restore a backup](ADVANCED.md#restore-a-backup). |
| The notice "Tietokanta on vaurioitunut. Ehjä varmuuskopio ... on tallessa, mutta sitä ei saatu käyttöön." | Free space on the disk (`df -h`, `docker image prune -f`) and run `docker compose restart banking`. The next start puts the copy in place. |
| The notice "Tietokanta oli vaurioitunut. Se palautettiin varmuuskopiosta ..." | The app moved the damaged file to `/data/damaged` and restored the copy. What was written after the copy is lost, and the next bank fetch brings the transactions again. Delete the old file in `/data/damaged` by hand when you no longer need it. |
| The page does not come back after *Palauta uusin varmuuskopio* | Docker's restart policy starts the app. If the page is not back in a minute, run `docker compose up -d` in the install folder. A request older than 15 minutes is dropped: the notice says "... mutta tiedot ovat ennallaan, koska pyyntö oli vanhentunut ennen käynnistystä", and you ask again. "... palautus epäonnistui käynnistyksessä" means the data is as it was: read the lines that start with `database:` in `docker compose logs banking`, most often the disk is full. |
| "Toinen toiminto on kesken." | Another action runs: an update, a restore that waits for the restart, or a reset that is still ending bank connections. Wait until it ends and try again. |
| "Tietojen haku on kesken. Yritä hetken päästä uudelleen." | *Tyhjennä kaikki tiedot* waits for a bank fetch to end. Try again in a moment. |
| The notice "Ehjää varmuuskopiota ei ole tehty 36 tuntiin." | The daily copy fails. Check the disk with `df -h` and `docker compose logs banking` for "backup failed", then take a copy under *Asetukset > Ylläpito*. |
| The notice "Varmuuskopio ... ei läpäissyt tarkistusta eikä sitä enää käytetä palautukseen." | The weekly check renamed the copy to `<name>.damaged` in `/data/backups`. It is neither restored from nor protected. Take a new copy, and delete the `.damaged` file by hand when you no longer need it. |
| The notice "Palvelimen levyllä on enää ... Mt vapaata tilaa." | Press *Siivoa levy* under *Asetukset > Ylläpito* and check `df -h`. Under 128 MB the app deletes its reserve file `/data/.reserve`, and the log says "the data disk is nearly full". |
| The notice "Ylläpitoapurista ei ole kuulunut vuorokauteen." | The helper has not reported for 24 hours. Run `./scripts/ops-helper.sh --self-test` as your normal user, and `./scripts/install.sh --ops-helper` if it fails. |
| "not enough free space for a database copy: ..." in the log or from `backup.sh`, or "Could not copy the database into the data volume ..." from `update.sh` | A copy needs twice the size of the database and its `-wal` file free in the folder it goes to. The old version still runs. Free space on the data volume, see it with `docker compose exec banking df -h /data`. |
| "No copy could be made before migrating, so ... did not run and the database is unchanged" | The server does not start, for the same reason: no room for the copy it takes before a migration. Free space and start the app again. |
| "database copies are not pruned: the live database ... fails its check" | No copy is deleted while the database fails its check, so that the copy you need stays. Restart the app: a damaged file is moved and an intact copy restored. |

## Away from home and second copies

| What you see | What to do |
|---|---|
| Your own domain has no certificate | Check that the DNS record points to your public address and that ports 80 and 443 are forwarded to the machine, then read `docker compose logs caddy`. |
| The Cloudflare address shows an error page | Read `docker compose logs tunnel`. Check that the tunnel's service is `http://banking:8080`. |
| Every page answers "Pääsy estetty." | The app checks the Cloudflare Access token itself and refuses a request without a valid one. Open the app at its Cloudflare address, not at the home address or `http://localhost:<port>`, which are closed once the check is on. If the Cloudflare address answers it too, `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` in `.env` is wrong. Fix it, or remove both lines and run `docker compose up -d`. Ten failed checks from one address within 15 minutes also close that address for the rest of the window. |
| After turning on remote access the home address no longer opens | That is meant. Open `https://<the address>` and sign in through Cloudflare. If nobody gets in within 15 minutes, the server takes the address off by itself and the home address works again, and *Asetukset > Turvallisuus* shows "Etäkäyttö poistettu, koska kukaan ei päässyt sisään". Check the address and that your email is on the list, then turn it on again. |
| Remote access is on and the page cannot be opened | Run `./scripts/install.sh --reconfigure` on the machine and choose another way in. The helper's copy of the `.env` from before its last change is `ops/env.prev`. |
| The Etäkäyttö page says the helper is missing or out of date | Run `./scripts/install.sh --ops-helper` on the machine. |
| `secret rotate` stops and names the Cloudflare API token | The token saved on the Etäkäyttö page cannot be opened with the current secret, so it cannot be sealed again. Nothing was changed. Save the token again on the page, which replaces it also while remote access is on, and run the rotation again. With remote access off you can remove the token instead and save it afterwards. |
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
| A debt may be counted twice, and *Saldot*, *Lainat* or the first page says "Sama velka voi olla summassa kahdesti" | A saved loan and a connected card or loan account may be the same debt, and until you say so both are counted. Open the loan under *Asetukset > Lainat*, choose the account in *Sama velka pankin tilillä* and save, or follow the link in the report's sentence. The debt then counts once, with the balance from the bank. |

## Figures and categories

How the figures are counted is in [Money flows](MONEY_FLOWS.md). The rows below are for a figure that looks wrong or a row that sits in the wrong category.

| What you see | What to do |
|---|---|
| A figure of an earlier month is not what it was before the update | The first start after an update sorts every row again with the newer rules. Categories, merchant names and card bills of past months can change, and so does every figure built on them. The bank's rows are as they were, and nothing is lost. A category you chose yourself stays. Your own rules and your marks on subscriptions follow a merchant to its new name. When several merchants get one name, a rule on one of them would reach them all, so it becomes your own category choice on the rows it covered, and a mark on one of them does not carry over to the new name. To see the rows behind a figure, open a category or a merchant name in a report or on a page: it opens *Tapahtumat* on those rows. There you can also search a merchant or a message and choose the account and the dates. |
| A category in *Kuukausitaulukko* or *Kategoriat* has a minus at the end | The category got more refunds than spending in the period. The totals still equal the expense in *Tulot ja menot*. |
| A payment to a person is in the wrong place, for example rent shown as *Maksut henkilöille* | The app tells a payment to a person from the name beside it and the words of the bank, and cannot know what the payment was for. Change the category on the row in *Tapahtumat*. If every payment to that name has the same purpose, tick *Käytä samaa kategoriaa kauppiaan muissa tapahtumissa*: old rows and later ones follow. If the person gets money for two things, write a rule instead: under *Tapahtumat > Kauppiaat*, in *Säännöt*, choose *Viesti*, write a word that the message holds (for example vuokra), choose the category and press *Lisää*. A category you chose by hand goes before a rule and stays after an update. The app learns nothing from one fix by itself: it does not read another person, another message or the next payment differently because of it. |
| Money from a relative or a friend is counted as income | A plain bank transfer from a person has no word in the row that tells it from pay, and the app can count it as income. Change the category on the row to *Maksut henkilöiltä*: it is then money from a person, and *Raportit* does not count it as earned income. To do that for every row from the sender, write a rule in *Säännöt* with the field *Kauppias*, the sender's name and the category *Maksut henkilöiltä*. The rule applies to money in only, so what you pay that person stays as it is. Money that moves between your own accounts is *Omat siirrot*, which leaves every total. |
| A loan payment is shown as shopping | The app reads a payment as a loan payment from the lender's name, the words of the row and whether that payee has paid credit to you, so a lender with a plain name and no such history can still show as shopping. Change the category on the row to *Kulutusluotot*, *Asuntolaina* or *Opintolaina*. To do it for every payment to that lender, write a rule in *Säännöt* with the lender's name. One fix teaches the app nothing about another lender, so each lender needs its own. |
| A card, an account or a loan is missing on the first page, or a card has no bar | *Kuukausi* lists accounts of the type *Käyttötili*, *Säästötili* and *Muu* under *Tilit*, accounts of the type *Luottokortti* under *Kortit*, and under *Lainat* the loans you saved and the connected loan accounts. Check the type under *Asetukset > Tilit*. A card has a bar when the bank gave its limit. A balance that is more than a day old carries its date. |
| The card on *Kuukausi* says "Seuraavat 30 päivää" and not a payday | It counts to the next regular pay. With no regular pay it keeps 30 days and says "Palkkapäivä ei ole tiedossa." When the pay is more than five days late it says "Palkka on myöhässä" and keeps the 30 days. *Laskut > Tulossa* keeps looking 30 days ahead. |
| The notice "Palkanmaksaja vaihtui" is still on *Kuukausi* | It stays for 120 days after the old payer's last payment. The income report keeps it for twelve months. Press *Kuittaa* to send it away. |
