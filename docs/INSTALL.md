# Install

You need Ubuntu Server 26.04 LTS on a machine that stays on at home, with 2 GB of memory and 20 GB of disk. A virtual
machine needs a bridged network adapter, so phones and laptops at home can reach it. Omatalous fetches from the bank
only while the machine is on and catches up the next time.

## 1. Get Omatalous

```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/jouni-mikkola/omatalous.git
cd omatalous
```

## 2. Install Omatalous

```bash
./scripts/install.sh --install-docker
```

The installer takes 5 to 10 minutes. `--install-docker` lets it install Docker with Docker's own script when Docker is
missing, and it installs `jq`, which the maintenance helper needs. It asks for your password for `sudo`, and once
whether to add your user to the `docker` group (press Enter). It then carries on in the same run, with no logging out.
If it still stops with "Your user has no access to Docker", log out and back in and run the same line again. Otherwise
it asks nothing. It binds the app to the machine's home network address over plain http and ends like this:

```
Omatalous is running: http://192.168.1.50:8080   (instance omatalous)
Set up: http://192.168.1.50:8080/#koodi=k3f9-2mxq-8hzt-p4wa   (the one-time code is in the link)
```

The first line is the address of Omatalous for the whole household. Reserve that address for the machine in your
router (DHCP reservation), so it stays the same.

If the installer stops with an error, look the message up in [TROUBLESHOOTING.md](TROUBLESHOOTING.md#during-the-install)
and run it again. A re-run is always safe.

## 3. Create the admin user

Open the *Set up* link on a device in your home network. The part after `#` is the one-time setup code, so copy
the whole link. The first user you create is the admin.

To look around first, press *Lataa esimerkkitiedot* on the empty start page. *Asetukset > Poista demodata* removes it.

## 4. Connect Nordea

The app walks you through registering a free Enable Banking app, once for the whole household. It takes about 15
minutes and gives the values to paste. Later you find the same steps under *Asetukset > Palvelin*.
[ENABLE_BANKING.md](ENABLE_BANKING.md) says why Nordea is linked twice and what the error messages mean.

The first fetch brings up to two years of history. After that Omatalous fetches at 6.15 and 18.15. Change the hours
under *Asetukset > Palvelin*.

## 5. Add the household

Optional. Add the others under *Asetukset > Talouden jäsenet*. Each gets a temporary password and picks their own at
the first login. Members do not register anything at Enable Banking. They press *Lisää pankkiyhteys* and log in with
their own Nordea ID. Under *Asetukset > Tilien jakaminen* a member can share an account with the others, read-only.

## After the install

- Updates show up under *Asetukset > Ylläpito*. Nothing updates before you press *Päivitä*.
- The app keeps a database copy from each of the last seven days on the machine. Now and then press *Lataa uusin* under
  *Asetukset > Ylläpito* and keep the file somewhere else. It holds your transactions unencrypted. Automatic backups to
  a NAS and restoring are in [ADVANCED.md](ADVANCED.md#backups).
- Lost the address? Run `./scripts/install.sh` again in the `omatalous` folder. It keeps the settings and data and
  prints the address.

Problems: [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Away from home, a second copy for another household and the rest:
[ADVANCED.md](ADVANCED.md).
