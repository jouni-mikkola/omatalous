# Install

You need Ubuntu Server 26.04 LTS on a machine that stays on at home, with 2 GB of memory and 20 GB of disk. A virtual
machine needs a bridged network adapter, so phones and laptops at home can reach it. Omatalous fetches from the bank
only while the machine is on and catches up the next time.

## 1. Get Omatalous

Paste this into a terminal on the machine, as your normal user:

```bash
curl -fsSLo omatalous-install.sh https://jouni-mikkola.github.io/omatalous/install.sh && echo "481871f3ed740a5d2fdd91c30ca62253ccd32705f6ff6eeb60747694c77591db  omatalous-install.sh" | sha256sum -c && bash omatalous-install.sh
```

`curl` saves the install script as `omatalous-install.sh`. `sha256sum -c` compares the file with the hash in the
command, and `bash` runs it only when they match. If the check prints `FAILED`, nothing has run: wait ten minutes for
the page to update and paste the command again. If it fails again, do not run the file, and report it as
[SECURITY.md](../SECURITY.md) says.

The script is [relay/install.sh](../relay/install.sh) in this repository. To read it first, paste the command only up
to `sha256sum -c`, read `omatalous-install.sh`, then run `bash omatalous-install.sh`. It clones the newest release into
`~/omatalous` and starts the installer there. Pasting the command again is safe: a folder that already holds Omatalous
is left as it is, and its installer runs.

Options go at the end of the command, after `bash omatalous-install.sh`. `--dir FOLDER` installs somewhere else and
`--port 8085` picks another port. [Advanced setups](ADVANCED.md#scripted-install) lists the rest.

## 2. Install Omatalous

The installer takes 5 to 10 minutes. It asks its questions first and then downloads and starts the app without waiting
for you. On a new machine it asks whether to install Docker and add your user to the `docker` group (press Enter),
and then for your password for `sudo`. On a plain first install it asks for nothing else.

If it stops with "Your user has no access to Docker", close the SSH connection, open it again and paste the command
from step 1 again, with the same options if you gave any.

It ends like this:

```
Omatalous is running: http://192.168.1.50:8080   (instance omatalous)
Set up: http://192.168.1.50:8080/#koodi=k3f9-2mxq-8hzt-p4wa   (the one-time code is in the link)
```

The first line is the address of Omatalous for the whole household. Reserve that address for the machine in your
router (DHCP reservation), so it stays the same.

If the installer stops with an error, look the message up in [Troubleshooting](TROUBLESHOOTING.md#during-the-install)
and paste the command again.

## 3. Create the admin user

Open the *Set up* link on a device in your home network. The part after `#` is the one-time setup code, so copy the
whole link. The first user you create is the admin.

The link works for 24 hours. After that the page says *Asennuskoodi on vanhentunut.* Run
`docker compose exec banking node dist/node.js setup-code` in the install folder for a new code.

To look around first, press *Lataa esimerkkitiedot* on the empty first page. *Poista esimerkkitiedot* in *Asetukset*
removes the example data.

## 4. Connect a bank

The app walks you through it after the first login. You register a free Enable Banking app, once for the whole
household, and then log in at your bank. [Connecting a bank](ENABLE_BANKING.md) has the steps.

After the first fetch Omatalous fetches at 6.15 and 18.15. The connections
are under *Asetukset > Pankit ja tilit*.

## 5. Add the household

Optional. Add the other members in *Asetukset*, under *Talouden jäsenet*. Each gets a temporary password and picks
their own at the first login. Members register nothing at Enable Banking. They press *Yhdistä pankki* and log in at
their own bank. A member can share an account with the others, read-only, with *Jaa tili* in the account's edit form.

## 6. Add your loans

Optional. A bank connection shows a card or a loan account, but not a loan at a lender that is not connected. Add
those in *Asetukset*, under *Lainat*, with the figures from your bank's page.

## After the install

- Updates show up in *Asetukset*, under *Ylläpito*. Nothing updates before you press *Päivitä*. A release is offered
  about two days after it comes out.
- The app keeps a database copy from each of the last seven days on the machine. Now and then press *Lataa uusin* under
  *Ylläpito* and keep the file somewhere else. It holds your transactions unencrypted. Automatic backups to another
  machine and restoring are in [Advanced setups](ADVANCED.md#backups).
- Lost the address? Run `./scripts/install.sh` again in the `omatalous` folder. It keeps the settings and data and
  prints the address.
- To use the app away from home, a VPN is the safest. [Advanced setups](ADVANCED.md#away-from-home) has the choices.

Problems: [Troubleshooting](TROUBLESHOOTING.md).
