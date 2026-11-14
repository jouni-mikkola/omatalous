# Omatalous

Your bank lists transactions. It does not tell you what your household earns, spends and has left. Omatalous does,
in one place. It runs on a machine at home, reads your bank accounts through [Enable Banking](https://enablebanking.com)
and sorts every transaction into a category. The first page shows what is left until the next payday after the bills
due before it.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/images/tour-still.png">
  <img src="docs/images/tour.png" alt="The app with the example household: the example data is loaded, the transactions get payees and categories, Yhteenveto takes the bills before payday from the balance, Laskut lists those bills, Raportit opens a category's rows, and the same pages show on a phone" width="1000">
</picture>

<img src="docs/images/overview-phone.png" alt="Yhteenveto on a phone, with the example household" width="260">

## Install

You need Ubuntu Server 26.04 LTS on a machine that stays on at home (x86-64 or arm64, such as a Raspberry Pi), with
2 GB of memory and 20 GB of disk. Paste this into a terminal on that machine, as your normal user:

```bash
curl -fsSLo omatalous-install.sh https://jouni-mikkola.github.io/omatalous/install.sh && echo "481871f3ed740a5d2fdd91c30ca62253ccd32705f6ff6eeb60747694c77591db  omatalous-install.sh" | sha256sum -c && bash omatalous-install.sh
```

The command downloads [a small script](relay/install.sh) and runs it only when its hash matches. After 5 to 10 minutes
the installer prints the address of the app and a setup link. [The install guide](docs/INSTALL.md) has each step.

## First steps

1. Open the setup link on a phone or computer at home and create the first user, who becomes the admin. Bookmark the
   address the installer printed. The whole household uses it.
2. To look around first, press *Lataa esimerkkitiedot* on the empty first page.
3. Connect your bank. You register a free app at Enable Banking with your email, and the setup walks you through it in
   about 15 minutes ([Connecting a bank](docs/ENABLE_BANKING.md)).
4. Add the other members of the household in *Asetukset*. Each has a login of their own.
5. After the first fetch, check the categories and answer what *Tarkistettavat* asks.

## Banks

The app can connect Nordea, OP,
Danske Bank, S-Pankki, the savings banks, POP Pankki, Aktia, Ålandsbanken and some card issuers. It was built and
tested mainly with Nordea, so check the categories of another bank in the first month.

The connection reads balances and transactions and cannot make payments. A consent lasts at most 180 days, and then you
log in at the bank again. If a bank does not give an account, you can load its statement file (CSV or camt.053) in the
browser instead.

## Your data

Transactions, bank keys and database copies stay on your machine, and the project runs no server that receives them.
The app calls Enable Banking for your transactions and GitHub for updates. It can look up business names in the
Finnish trade register, never amounts, dates, account numbers or names of people, and the admin can turn the lookup off.
[Security and privacy](docs/SECURITY.md) lists what is stored and what connects where.

## Licence

Omatalous is open source under the [GNU Affero General Public License 3.0](LICENSE) (AGPL-3.0-only). Every copy and
modified version keeps the attribution "Omatalous, Jouni Mikkola" and a link to this repository in the footer of the
app. [LICENSE](LICENSE) has the terms, also those of earlier versions.

The Nordea logo in `apps/web/public/banks/` is Nordea's trademark, and the licence does not cover it. The notices of
every package in the build are in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).

Omatalous is built and maintained by [Jouni Mikkola](https://www.linkedin.com/in/jouni-mikkola). If it is useful to
you, you can [buy me a coffee](https://buymeacoffee.com/jouni.mikkola). To work on the code, start from
[CONTRIBUTING.md](CONTRIBUTING.md).
