# Omatalous

Omatalous gathers a Finnish household's Nordea accounts and credit cards into one view and shows where the money goes.
It runs on your own Linux machine at home, and you use it in a browser, in Finnish.

![Omatalous overview](docs/images/yleiskatsaus.png)

- Fetches new Nordea transactions by itself through Enable Banking, which is free for your own accounts
- Sorts every purchase, loan payment, saving and income, and finds recurring bills and subscriptions
- Warns about double charges and late fees
- Gives each household member a login of their own, with accounts shared read-only when they want
- Updates from a button in the browser and goes back by itself if an update fails

## Install

You need Ubuntu Server 26.04 LTS on a machine that stays on at home, with 2 GB of memory and 20 GB of disk.

```bash
sudo apt update && sudo apt install -y git jq
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER        # then log out and back in

git clone https://github.com/jouni-mikkola/omatalous.git
cd omatalous
./scripts/install.sh
```

The installer prints a link. Open it on a device in your home network, create the admin user and follow the checklist
for connecting Nordea. The [install guide](docs/INSTALL.md) has the same steps with a few more words.

## Update

*Asetukset > Ylläpito* tells you when a new version is out. Press *Päivitä*.

## More

| When you want to | Read |
|---|---|
| Fix something that does not work | [Troubleshooting](docs/TROUBLESHOOTING.md) |
| Use the app away from home | [Away from home](docs/ADVANCED.md#away-from-home) |
| Give your parents or another household a copy of their own | [A second copy](docs/ADVANCED.md#a-second-copy-on-the-same-machine) |
| Back up to a NAS or move to a new machine | [Backups](docs/ADVANCED.md#backups) |
| Know how the money is counted | [Money flows](docs/MONEY_FLOWS.md) |
| Know what is stored and who can see it | [Security and privacy](docs/SECURITY.md) |

For developers: [development](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md), [releasing](docs/RELEASING.md)
and the [changes](CHANGELOG.md) in each version. Report a vulnerability as [SECURITY.md](SECURITY.md) says.

## Screenshots

The pictures use demo data.

<details>
<summary>Show screenshots</summary>

| | |
| --- | --- |
| ![Yleiskatsaus](docs/images/screens/yleiskatsaus.webp) | ![Raportit](docs/images/screens/raportit.webp) |
| ![Tapahtumat](docs/images/screens/tapahtumat.webp) | ![Kategoriat, Kauppiaat](docs/images/screens/kauppiaat.webp) |
| ![Toistuvat](docs/images/screens/toistuvat.webp) | ![Tumma teema](docs/images/screens/tumma.webp) |

<img src="docs/images/screens/puhelin.webp" alt="Yleiskatsaus puhelimella" width="240">

</details>

## Licence

MIT, see [LICENSE](LICENSE). The bank logos in `apps/web/public/banks/` are the banks' trademarks, and the licence does
not cover them.
