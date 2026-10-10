# Install

This takes you from an empty machine to your Nordea transactions in Omatalous. Plan an hour, most of it waiting for the
install and for the Enable Banking registration. Things you need later, such as several instances, restoring a backup by
hand and starting over, are in [OPERATIONS.md](OPERATIONS.md).

## 1. A machine

Any machine or VM that stays on, with 2 GB of memory and 20 GB of disk (the image build needs about 1.5 GB of memory and
2 GB of free disk). A VM needs a bridged network adapter, so it gets its own address in the home network and phones and
laptops can reach it. The machine must be on for the scheduled bank fetches. Missed days are fetched next time.

Install [Ubuntu Server LTS](https://ubuntu.com/download/server) with the default answers and tick Install OpenSSH
server. You can then do the rest from your own computer with `ssh`.

## 2. Install Omatalous

Log in to the machine and run these three commands.

```bash
git clone https://github.com/jouni-mikkola/omatalous.git
cd omatalous
./scripts/install.sh
```

The installer asks no setup questions. It offers to install Docker if it is missing (answer K), pulls and verifies the signed release image (it builds the source when the checkout is ahead of the newest release, or no release exists yet), starts the app
and installs the maintenance helper, which needs `jq` and a normal user (not root). The first start takes a few minutes. At the end it prints the address and a setup link.

```
Omatalous on käynnissä: http://192.168.1.50:8080   (asennus banking-app)
Ota käyttöön: http://192.168.1.50:8080/#koodi=k3f9-2mxq-8hzt-p4wa   (kertakäyttöinen koodi on linkissä)
Varaa koneelle kiinteä osoite reitittimestä (DHCP-varaus), niin osoite ei vaihdu. Ylläpitoapuri: käytössä (systemd-ajastin).
```

The installer gives the app the machine's home network address, the one it uses to reach the router, if that address is
private (10.x, 172.16 to 172.31 or 192.168.x). Otherwise it listens on `127.0.0.1` only. The connection is plain http,
which is fine inside your home. Running the installer again is safe. It keeps its answers and carries on from where a
stopped run ended.

Reserve the printed address for the machine in the router (a DHCP reservation), so it does not change. If the machine
gets its address only after the network starts at boot and the app does not come up, `doctor.sh` says so. Setting
`net.ipv4.ip_nonlocal_bind=1` in `/etc/sysctl.d/` lets Docker bind the address before it exists.

## 3. First login

Open the setup link, or the address and enter the setup code, and create your own user. This user is the admin. Use a
password of at least 12 characters and keep it in a password manager.

## 4. Connect Nordea

The setup has one step, the Enable Banking app. Enable Banking is the free service that lets Omatalous read your Nordea
accounts. You register it once for the whole household, which takes about 15 minutes. Follow the checklist on screen.
[ENABLE_BANKING.md](ENABLE_BANKING.md) has the same steps with screenshots. The Application ID is tested when you save it.

Then press *Lisää pankkiyhteys* and choose Nordea. You log in at Nordea and pick an account. After that the bank returns
your browser to the app, see [Linking a bank](#linking-a-bank). Repeat with *Lisää seuraava tili* for each account and
credit card.

The first fetch runs in the background and brings up to two years of history. After that Omatalous fetches new transactions
in the hours you chose, at most four a day.

To look around before registering, press *Lataa demodata* on the empty overview. *Poista demodata* under *Asetukset*
removes it.

## 5. The household

Add the others under *Asetukset > Talouden jäsenet*. Each gets a temporary password and connects their own Nordea
accounts with their own Nordea ID. A member can show an account to the others, read-only, under
*Asetukset > Tilien jakaminen*.

The rest of this page is for later.

## Reaching the app

### At home

The app listens on the machine's home network address, for example `http://192.168.1.10:8080`. The connection is not
encrypted, so keep guests and smart devices on a guest network. Another instance takes the next port
([OPERATIONS.md](OPERATIONS.md#several-instances-on-one-machine)).

### Linking a bank

Enable Banking sends your browser back to the address you registered. With a home network address that is the
project's return page, `https://jouni-mikkola.github.io/omatalous/paluu/`. It forwards your browser to your own
address, and only to private addresses. Your server is not reachable from the internet and does not need to be. Link on a
device that is on the home network. The page stores nothing and loads nothing from other sites.

If the page does not open, copy the whole address of the page the bank shows and paste it under
*Asetukset > Pankkiyhteydet > Paluusivu ei auennut?*. An install made before the return page keeps that paste step until
the admin adds the return page address in Enable Banking and presses *Ota käyttöön* under *Asetukset > Palvelin*.

### Away from home

- A VPN to the home network, such as WireGuard on the router. The phone is then on the home network and uses the same
  address as at home.
- Behind a 4G or 5G home connection (no public address), a Cloudflare Tunnel. You need a domain on Cloudflare and a
  tunnel token from Cloudflare Zero Trust. Set the tunnel's public hostname to `http://banking:8080` and add a
  Cloudflare Access rule that lets in only your own email addresses. Cloudflare then sees the traffic in clear text.
- Your own domain with Caddy gets a Let's Encrypt certificate. It needs a public IP address, a DNS record that points to
  it and ports 80 and 443 forwarded to the machine. This puts the login page on the internet. Use it only if you want that.

Run `./scripts/install.sh --reconfigure` and pick Cloudflare Tunnel or Oma domain. With https the bank sends you back to the
app by itself and the paste step goes away. Add the new return address, shown under *Asetukset > Palvelin*, to your app in
the Enable Banking Control Panel.

### Several instances

One return page address serves all of them. An instance with its own https name has its own redirect URL.

## Updates and backups

*Asetukset > Palvelin > Ylläpito* tells when a new version is out and shows what changed. *Päivitä* asks for your
password, copies the database and goes back by itself if the new version does not start. Nothing updates without you.

Omatalous copies its database every night and keeps the last seven copies on the machine. Now and then press *Lataa
uusin* and keep the file on another device. It holds all your transactions unencrypted. It does not hold the key that
opens the saved bank keys, so after a restore on a new machine you set up Enable Banking again. The transactions stay.
Scheduled copies on the host, encryption and restoring by hand are in [OPERATIONS.md](OPERATIONS.md#backups).

To have Ubuntu install security updates by itself:

```bash
sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
```

## Ylläpitoapuri

The buttons under *Asetukset > Palvelin > Ylläpito* work through a small helper on the machine. The installer sets it up.
The page says if it is missing or has not answered, and shows the command that fixes it:

```bash
./scripts/install.sh --ops-helper
```

How it works and what it is trusted with: [OPERATIONS.md](OPERATIONS.md#the-maintenance-helper) and
[SECURITY.md](SECURITY.md#updates-and-the-maintenance-helper).

## When something is wrong

1. Press *Tarkista järjestelmä* under *Asetukset > Palvelin > Ylläpito*. If the page does not open, run
   `./scripts/doctor.sh` on the machine. It only reads, names the problem and gives the next command. Exit code 0 means
   all is well, 1 a problem, 2 warnings only.
2. Press *Käynnistä sovellus uudelleen*, or run `docker compose restart banking`.
3. If the trouble began with an update, press *Palauta edellinen versio* or run `./scripts/update.sh --rollback`.
4. Read the log with `docker compose logs banking`.
5. Restore a backup or start over ([OPERATIONS.md](OPERATIONS.md#backups)).

| Symptom | Fix |
|---|---|
| The address does not open on a phone | a VM needs a bridged network adapter |
| `permission denied ... docker.sock` | log out and back in, then run `./scripts/install.sh` again |
| The build runs out of memory | give the machine 2 GB, or add swap |
| Installer says the disk is full | `docker image prune -f; docker builder prune -f`, then run the script again |
| Installer says the build has no network | check `curl -I https://registry.npmjs.org` and `docker pull node:22-alpine` |
| "Docker Hub rajoittaa latauksia" | wait an hour, or `docker login`, then run the script again |
| Port taken | `./scripts/install.sh --reconfigure --port 8085` (`ss -ltnp 'sport = :8080'` shows who has it) |
| "Toinen asennus on jo käynnissä" | another `install.sh` or `update.sh` runs in this directory. Wait for it |
| The bank's return page does not open | paste the address, see [Linking a bank](#linking-a-bank). If the app says a redirect URL is not registered, add the URL it names in Enable Banking |
| "Enable Banking hylkäsi avaimen (401/403)" | the Application ID is from another app, or no account is linked in the Enable Banking Control Panel |
| An account is missing | link it in the Enable Banking Control Panel, then add the bank connection again |
| Login does not stick on an https address | use the address shown under *Asetukset > Palvelin* |
| Container restarts, log says `TIETOKANTA: …` | the database is from a newer version: run `./scripts/update.sh`, or `--rollback` |
| Caddy has no certificate | DNS record, port forwarding and `docker compose logs caddy` |
| Forgotten admin password | `docker compose exec banking node dist/node.js user reset-password <user>` |
