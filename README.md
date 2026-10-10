# Omatalous

Omatalous shows a Finnish household's Nordea accounts and cards in one place and sorts the money into spending, savings, debt and income. It runs on a Linux machine at home, and the household uses it in a browser, in Finnish.

![Yleiskatsaus](docs/images/yleiskatsaus.png)

## What it does

- Reads Nordea current accounts, savings accounts and credit cards through PSD2 (Enable Banking), or a CSV export
- Sorts every transaction into spending, debt, savings, income or borrowing, with your own rules and a category per merchant
- Shows an overview with monthly spending, recurring costs and subscriptions, alerts for double charges and late fees, and reports
- Gives each household member their own login, with optional read-only sharing of accounts
- Updates and backups start from a button in the browser, and an update can be rolled back

## Kuvia sovelluksesta

Kuvat ovat demodatasta.

<details>
<summary>Näytä kuvat</summary>

| | |
| --- | --- |
| ![Yleiskatsaus](docs/images/screens/yleiskatsaus.webp) | ![Raportit](docs/images/screens/raportit.webp) |
| ![Tapahtumat](docs/images/screens/tapahtumat.webp) | ![Kategoriat, Kauppiaat](docs/images/screens/kauppiaat.webp) |
| ![Toistuvat](docs/images/screens/toistuvat.webp) | ![Tumma teema](docs/images/screens/tumma.webp) |

<img src="docs/images/screens/puhelin.webp" alt="Yleiskatsaus puhelimella" width="240">

</details>

## Install

You need an Ubuntu or Debian machine or VM that stays on and has 2 GB of memory. Run these three commands on it.

```bash
git clone https://github.com/jouni-mikkola/omatalous.git
cd omatalous
./scripts/install.sh
```

The installer sets up Docker if it is missing, starts Omatalous and prints an address and a setup link. Open the link on any device at home and create your user. The browser then guides you through connecting Nordea.

## Next

- [Installing on an empty machine](docs/INSTALL.md), with the first Nordea data, using the app away from home and what to do when something fails
- [Connecting Nordea, with screenshots](docs/ENABLE_BANKING.md)
- [How the money is counted](docs/MONEY_FLOWS.md)
- [Security and privacy](docs/SECURITY.md), and how to [report a vulnerability](SECURITY.md)
- [Operations](docs/OPERATIONS.md): several instances, backups, restore, starting over, the command line
- [Changes](CHANGELOG.md)
- [Development](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md) and [releasing](docs/RELEASING.md)

## Try it without a bank

```bash
corepack enable && pnpm install && pnpm build
pnpm seed:demo    # user "demo", password "demo-salasana-123", 14 months of sample data
pnpm start        # http://localhost:8080
```
