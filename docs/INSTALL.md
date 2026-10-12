# Install

You need Ubuntu Server 26.04 LTS on a machine that stays on at home, with 2 GB of memory and 20 GB of disk. A virtual
machine needs a bridged network adapter, so phones and laptops at home can reach it. Omatalous fetches from the bank
only while the machine is on and catches up the next time.

## 1. Get Omatalous

Paste this into a terminal on the machine, as your normal user:

```bash
curl -fsSLo omatalous-install.sh https://jouni-mikkola.github.io/omatalous/install.sh && echo "b744b460e74dd1a65e9146c85541dcc6d291cd2d16929ac8ac930e4bd50aab38  omatalous-install.sh" | sha256sum -c && bash omatalous-install.sh
```

`curl` saves the install script as `omatalous-install.sh`. `sha256sum -c` compares the file with the hash in the
command, and `bash` runs it only when they match. If the check prints `FAILED`, nothing has run: wait ten minutes for
the page to update and paste the command again. If it fails again, do not run the file, and report it as
[SECURITY.md](../SECURITY.md) says.

The script is [relay/install.sh](../relay/install.sh) in this repository. The pasted command runs it at once. To read it
first, paste the command only up to `sha256sum -c`, read `omatalous-install.sh`, then run `bash omatalous-install.sh`.
It does this and nothing else:

- It stops when run as root. It needs `curl` and `git`, and offers to install them with `apt`.
- It asks GitHub for the newest release of Omatalous.
- It clones the repository into `~/omatalous` and checks out that release, only when the release is on the `main` branch.
- It starts `scripts/install.sh --install-docker` in the clone.

A folder `~/omatalous` that already holds a clone of Omatalous is left as it is, and its installer runs, so pasting the
command again is safe. Anything else in that place stops the script. Options go at the end of the command, after
`bash omatalous-install.sh`. `--dir FOLDER` clones somewhere else. `--new-instance NAME` makes a second copy in `~/NAME`, on the latest release
(see [a second copy](ADVANCED.md#a-second-copy-on-the-same-machine)). The script hands every other option to the
installer, for example `--port 8085`.

If you clone the repository yourself and run `./scripts/install.sh` in the clone, the installer asks GitHub once which
release is out. A clone of `main` can sit on the tag of a release that waits out its first two days, and then it says
"This folder is at vX.Y.Z, which is not out yet (a release waits two days). Installing the latest release, vY.Z.W.",
moves the folder to that release and starts again from there. When GitHub does not answer, it goes on with the release
the folder is at and says "GitHub could not be asked which release is out, so the release this folder is at could not be
confirmed. The install goes on with it." A folder that already has a `.env` is never asked and never moved.

## 2. Install Omatalous

The script now runs the installer, which takes 5 to 10 minutes. Any question the installer has (Docker's install, the
docker group, how the app is reached, the address, the port) comes first, and then it installs and builds without
waiting for you. `--install-docker` lets it install Docker with Docker's own script when Docker is missing, and it installs
`jq`, which the maintenance helper needs. It asks for your password for `sudo`, and once whether to add your user to the
`docker` group (press Enter). After it adds your user to the group it carries on in the same run, with `sg` or, on
Ubuntu 26.04.1, which has no `sg`, with `sudo`. If it still stops with "Your user has no access to Docker", close the
SSH connection, open it again (or log out and in on the machine itself) and paste the command from step 1 again, with
the same options if you gave any. On a plain first install it asks for nothing else. It binds the app to the machine's
home network address over plain http and ends like this:

```
Omatalous is running: http://192.168.1.50:8080   (instance omatalous)
Set up: http://192.168.1.50:8080/#koodi=k3f9-2mxq-8hzt-p4wa   (the one-time code is in the link)
```

The first line is the address of Omatalous for the whole household. Reserve that address for the machine in your
router (DHCP reservation), so it stays the same. If the router hands the machine another address anyway, the
maintenance helper moves the app to it after ten minutes, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#opening-the-app).
The setup link works for 24 hours. If `qrencode` is installed (`sudo apt install qrencode`, and run the
installer again), the setup link is also shown as a QR code for your phone.

Choosing a Cloudflare Tunnel as the way in (see [Away from home](ADVANCED.md#cloudflare-tunnel)) without a settings file
offers to run `./scripts/cloudflare-setup.sh`. That script shows where in the Cloudflare dashboard the API token is made
and which permissions it needs, and asks for the token, the domain and the emails that Access lets in.

If the installer stops with an error, look the message up in [TROUBLESHOOTING.md](TROUBLESHOOTING.md#during-the-install)
and paste the command again. A re-run is always safe.

## 3. Create the admin user

Open the *Set up* link on a device in your home network. The part after `#` is the one-time setup code, so copy
the whole link. The first user you create is the admin.

The setup code works for 24 hours. After that the page says *Asennuskoodi on vanhentunut.* In the install folder,
`docker compose exec banking node dist/node.js setup-code` prints a new code to type into the page. A `SETUP_CODE` kept in
`.env` does not expire.

To look around first, press *Lataa esimerkkitiedot* on the empty start page. The card *Esimerkkitiedot* in *Asetukset* has *Poista esimerkkitiedot*, which removes it.

## 4. Connect a bank

The app walks you through registering a free Enable Banking app, once for the whole household. It takes about 15
minutes and gives the values to paste. Later you find the same steps under *Asetukset > Tekniset asetukset > Palvelin*.
Then *Asetukset > Pankkiyhteydet > Yhdistä pankki* opens a list of the banks your Enable Banking app offers: Nordea,
OP, Danske Bank, S-Pankki, the savings banks, Aktia and the other Finnish banks and card issuers that
[ENABLE_BANKING.md](ENABLE_BANKING.md) lists, each with its logo where Enable Banking has one. The first fetch brings
up to two years of history. Each connection has a button *Yhdistä uudelleen* that renews it, also before it ends, and
*Muistutus kalenteriin* downloads a calendar event for seven days before it ends. The guide says why Nordea is linked twice, how the other
banks differ and what the error messages mean.

After that Omatalous fetches at 6.15 and 18.15. Change the hours under *Asetukset > Tekniset asetukset > Palvelin*.

A bank connection is the only way transactions come in. The import of Nordea CSV files was removed in 0.9.0. An account
that an older version made from CSV files stays with its rows, and when you connect the same account through the bank,
those rows move into the bank's account.

## 5. Add the household

Optional. Add the others under *Asetukset > Talouden jäsenet*. Each gets a temporary password and picks their own at
the first login. Members do not register anything at Enable Banking. They press *Yhdistä pankki* and log in with
their own Nordea ID. Under *Asetukset > Tilien jakaminen* a member can share an account with the others, read-only.

## 6. Add your loans

Optional. A bank connection shows a card or a loan account, but not a loan at a lender that is not connected. Under
*Asetukset > Lainat* you can tell Omatalous about those. Paste a screenshot or the text of a loan (Ctrl+V, or paste on
the phone), drop or pick a picture or a PDF, or type the figures. A bank's loan page, the positive credit register's
listing and a SECCI form all work, and one screenshot of the register brings every lender at once. The app reads the
lender, what is left to pay (*Lainaa jäljellä*), the rate, the payment (*Maksuerä*) and the last due date (*Viimeinen
eräpäivä*) into a form for each loan. A picture, a PDF and a text are read in the browser and sent nowhere. The first
picture takes a moment, because the reader is fetched from the app itself, about 11 MB once.

Each figure shows the line it was read from and a mark: *Varma*, *Tarkista* or *Ei löytynyt*. Everything read from a
picture is *Tarkista*, and *Tallenna* waits until you have ticked each of those as right or corrected it. Nothing is
saved before *Tallenna*. Above the list of loans the page also shows monthly payments to one payee that look like a loan
nobody has saved, with *Tallenna lainaksi* and *Ei laina* for each. When a saved loan is the same debt as a connected
card or loan account, choose that account in *Sama velka pankin tilillä* in the loan's form. The debt then counts once,
with the balance from the bank.

A household with a saved loan gets a *Lainat* section in *Raportit* with what is owed, the interest of the next 12 months
and the payments a month. *Saldot* shows the connected accounts less the saved loans as *Tilit miinus velat*, and
*Säästövinkit* reads the loans too. A figure the app does not know reads "ei tiedossa", never zero. How the figures are counted is in
[MONEY_FLOWS.md](MONEY_FLOWS.md). If a reading fails, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#loans).

## After the install

- Updates show up under *Asetukset > Tekniset asetukset > Ylläpito*. Nothing updates before you press *Päivitä*. A release is offered about
  two days after it comes out. The switch *Tarjoa uudet versiot heti* on the same page offers it at once. Without the
  maintenance helper there is no switch, and `TALOUS_PRERELEASE=yes` in `.env` does the same, see
  [Updates in detail](ADVANCED.md#updates-in-detail).
- The app keeps a database copy from each of the last seven days on the machine. Now and then press *Lataa uusin* under
  *Asetukset > Tekniset asetukset > Ylläpito* and keep the file somewhere else. It holds your transactions unencrypted. Automatic backups to
  a NAS and restoring are in [ADVANCED.md](ADVANCED.md#backups). *Palauta uusin varmuuskopio* in the same place
  brings the newest copy back, and at every start the app checks its database and restores a damaged one from the
  newest intact copy.
- Lost the address? Run `./scripts/install.sh` again in the `omatalous` folder. It keeps the settings and data and
  prints the address.
- To use the app away from home, a VPN is the safest. A Cloudflare Tunnel with a login in front can be set up in the
  browser, under *Asetukset > Tekniset asetukset > Palvelin > Etäkäyttö*, or with the installer. Make the Cloudflare API token with the
  permissions [ADVANCED.md](ADVANCED.md#cloudflare-tunnel) lists, turn on Zero Trust in the Cloudflare dashboard (the
  Free plan is enough), and expect to open the new address within 15 minutes of turning it on, or the app goes back to
  the home address by itself.

Problems: [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Away from home, a second copy for another household and the rest:
[ADVANCED.md](ADVANCED.md).
