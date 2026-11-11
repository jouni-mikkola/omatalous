# Omatalous

Omatalous is a personal finance app for a Finnish household that runs in Docker on your own Linux machine and reads
your bank accounts through PSD2, by way of [Enable Banking](https://enablebanking.com). It opens on one sum: what is
left until the next payday after the bills due before it.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/images/omatalous-still.png">
  <img src="docs/images/omatalous.png" alt="A short animation of Omatalous with example data, in English. It shows the four tabs: what is left until payday, the month's spending by category against a usual month, the bills coming before payday and a question the app asks the household, and then the transactions sorted into categories.">
</picture>

![Nyt, the first page, with example data: 3 025 euros left until payday on the 25th, 216 euros a day, the month's spending of 2 027 euros against the usual band to the same day, and a chart of the month's spending day by day](docs/images/nyt.png)

## What it does

The app fetches the household's transactions from the bank at 6 and 18 by default, sorts each one and shows the result in
Finnish or English, in a browser on a computer or a phone. All figures above and below are from the example household that comes
with the code.

The app has four tabs, one for each question a household asks of its money.

- Nyt (now): how much is left until the next payday after the bills due before it, per day, and how this month's
  spending compares with a usual month on the same day.
- Kuukausi (month): this month's spending by category against the usual to the same day, the categories that explain
  the difference first. Earlier months are a click back.
- Tulossa (coming): the bills and income before the next payday, and the bills, contracts and subscriptions that
  repeat, with their next date. A bill the app has not seen yet is added by hand.
- Tarkistettavat (to review): every question the app cannot settle itself, such as which kind of loan a repeating
  payment is or which category an unknown payee belongs to, asked one at a time.

A figure opens the transactions behind it. Lisää (more), in the user menu, has the longer views: the year, accounts
and balances, loans, the tax year and, when two members share an account, its costs.

- Every money movement goes into one of five flows: spending, loan payments, saving, income and borrowing. A move
  between your own accounts counts in none of them, and neither does a card bill when the card's account is connected.
  [Money flows](docs/MONEY_FLOWS.md) explains each rule.
- A bank's CSV export, a camt.053 statement or a card statement (CSV or text) is read in the browser, and only
  its rows go to the install. It fills an account the bank does not give through PSD2.
- A joint account is split between its users by who paid into it, equally or by percentages, and each member sees
  their own part.
- A loan at a lender that is not connected is typed into a short form.
- Most tables of more than ten rows download as CSV.
- The database is copied every day. If the database is damaged, the app starts from the newest intact copy. With the
  maintenance helper, updates and rollbacks run from the settings page, and an update that leaves the app not answering
  is taken back.

<table>
<tr>
<td width="50%"><img src="docs/images/kuukausi.png" alt="Kuukausi: spending of 2 027 euros from the 1st to the 11th against the usual 2 040 euros, and the categories that explain the difference, each with its sum, its usual sum and the gap in euros"></td>
<td width="50%"><img src="docs/images/tulossa.png" alt="Tulossa: three bills before payday that add up to 1 900,54 euros, the payday on the 25th, and the list of bills, contracts and subscriptions with their kind, next date and amount"></td>
</tr>
<tr>
<td>Where this month's money went, against a usual month.</td>
<td>The bills before payday and what repeats.</td>
</tr>
<tr>
<td><img src="docs/images/tarkistettavat.png" alt="Tarkistettavat: question 1 of 9 asks which kind of loan a repeating 289 euro payment to Nordea Rahoitus Suomi Oy is, with its last three payments and the car loan suggested"></td>
<td><img src="docs/images/tapahtumat.png" alt="Tapahtumat: the rows by day with the payee, the bank's message, the account and the category, a search field and filters above them"></td>
</tr>
<tr>
<td>A question the app asks instead of guessing.</td>
<td>Every transaction with its category.</td>
</tr>
<tr>
<td><img src="docs/images/tilit.png" alt="Asetukset > Pankit ja tilit: a linked bank with its four accounts and cards, the consent valid until May, the time of the last fetch, and the accounts with their balances"></td>
</tr>
<tr>
<td>The bank link and the accounts in Asetukset.</td>
</tr>
</table>

<img src="docs/images/nyt-puhelin.png" alt="Nyt on a phone: the sum left until payday, the spending chart and the four tabs at the bottom of the screen" width="240"> <img src="docs/images/tarkistettavat-puhelin.png" alt="Tarkistettavat on a phone: the loan question with its payments and the answers as buttons" width="240">

## Banks

New transactions come from the bank through [Enable Banking](https://enablebanking.com), which is free when you read
only your own accounts. The app only reads: the bank consent covers balances and transactions for at most 180 days, and
the app cannot make payments.

The bank list has 17 Finnish banks and card issuers. The app offers those that Enable Banking's live list has for your
application.

| Bank | Status |
|---|---|
| Nordea | Built and tested mainly with Nordea data, so it works best. |
| OP, Danske Bank, S-Pankki, Säästöpankki, Oma Säästöpankki, POP Pankki, Aktia, Ålandsbanken and the others on the list | Can be connected. Less tested: check the categories of the first month. |

[Connecting a bank](docs/ENABLE_BANKING.md) explains the setup.

## Your data

- Transactions, bank keys and database copies stay on your machine. Nothing is sent to the project.
- The app asks Enable Banking for your transactions. It can also look up business names in the Finnish trade register,
  never amounts, dates, account numbers or names of people, and an admin can turn the lookup off.
- Each household member has a login of their own and sees only their own accounts and those shared with them, read-only.
- Bank keys are stored encrypted with a secret that lives in a file outside the database.

[Security and privacy](docs/SECURITY.md) lists what is stored and what connects where.

## Install

You need Ubuntu Server 26.04 LTS on a machine that stays on at home (x86-64 or arm64, such as a Raspberry Pi), with
2 GB of memory and 20 GB of disk. Paste this into a terminal on that machine, as your normal user:

```bash
curl -fsSLo omatalous-install.sh https://jouni-mikkola.github.io/omatalous/install.sh && echo "481871f3ed740a5d2fdd91c30ca62253ccd32705f6ff6eeb60747694c77591db  omatalous-install.sh" | sha256sum -c && bash omatalous-install.sh
```

The command downloads a small script, checks its sha256 against the one in the command and runs it only when they
match. The script is [relay/install.sh](relay/install.sh) in this repository. It puts Omatalous in `~/omatalous` at the
newest release and starts the installer. On a new machine the installer installs Docker and `jq` and gives your user
the Docker right, asking once. If it says your user has no access to Docker, reconnect over SSH and paste the
command again, with the same options if you gave any. It then prints a link, also as a QR code when `qrencode`
is installed. Open it on a device in your home network, create the admin user and follow the setup for connecting your
bank. The [install guide](docs/INSTALL.md) has the same steps with a few more words.

## How it is built

```mermaid
flowchart LR
  browser["Browser"] <--> app
  subgraph machine["Your Linux machine"]
    app["Omatalous<br/>one container: page and server"] --> db[("Database<br/>on the disk")]
    helper["Maintenance helper"] -->|"polls for requests"| app
  end
  app --> eb["Enable Banking"] --> banks["Banks"]
  helper --> gh["GitHub Releases"]
```

One container holds the page and the server, and the database is a SQLite file on the machine's disk. The helper on
the host runs updates, backups and rollbacks, and takes updates from GitHub Releases.

The code is TypeScript in three packages. `packages/core` holds the rules and the figures with no input or output of
its own, so the same code runs on the server and in the browser. `apps/server` is a [Hono](https://hono.dev) server on
Node.js 24 with its built-in SQLite, and `apps/web` is a React page built with Vite, with charts drawn in SVG by the app
itself. Money is counted in whole cents. A change lands after the type checks, the Vitest suites, the shell suites and the
Playwright tests of the pages pass. See [Architecture](docs/ARCHITECTURE.md) and [Development](docs/DEVELOPMENT.md).

## Documentation

| Document | What is in it |
|---|---|
| [Install](docs/INSTALL.md) | The install step by step, and how to update later. |
| [Connecting a bank](docs/ENABLE_BANKING.md) | Choosing a bank, the two Nordea links, and what the error messages mean. |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Fixes for what does not work. |
| [Advanced setups](docs/ADVANCED.md) | Use away from home, a second copy for another household, backups and restore, starting over. |
| [Money flows](docs/MONEY_FLOWS.md) | How each transaction is counted. |
| [Security and privacy](docs/SECURITY.md) | What is stored, what connects where and who can see it. |
| [Architecture](docs/ARCHITECTURE.md) | The decisions and the structure of the code. |
| [Development](docs/DEVELOPMENT.md) | Running and testing the code. |
| [Releasing](docs/RELEASING.md) | How a release is made. |
| [Changes](CHANGELOG.md) | What changed in each version. |

To report a vulnerability, follow [SECURITY.md](SECURITY.md). For issues and pull requests, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Releases

Releases and their notes are on the [releases page](https://github.com/jouni-mikkola/omatalous/releases) and in
[CHANGELOG.md](CHANGELOG.md). Each release is a signed Docker image for linux/amd64 and linux/arm64, and an update checks the
signature before it starts the image. The app offers an update on its maintenance page when the helper is on.

## Author

Built and maintained by [Jouni Mikkola](https://www.linkedin.com/in/jouni-mikkola).

## Credits

Omatalous stands on these projects and services.

| Project or service | Used for | Licence or terms |
|---|---|---|
| [Enable Banking](https://enablebanking.com) | the PSD2 connection to the banks | a service under its own terms |
| [PRH open data](https://avoindata.prh.fi) | business names and industries from the Finnish trade register | open data of the Finnish Patent and Registration Office |
| [Statistics Finland](https://stat.fi) | the consumer price index, only if the admin turns it on | open statistics of Statistics Finland, under its own terms |
| [Hono](https://hono.dev) | the server | MIT |
| [React](https://react.dev) | the page | MIT |
| [Vite](https://vite.dev) | building the page | MIT |
| [Node.js](https://nodejs.org) and its built-in [SQLite](https://sqlite.org) | running the server and the database | MIT, SQLite is in the public domain |
| [IBM Plex Sans](https://github.com/IBM/plex) | the font | OFL-1.1 |

The notices of every package in the build are in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).

## Licence

Omatalous is open source under the [GNU Affero General Public License 3.0](LICENSE) (AGPL-3.0-only), with one
additional term under its section 7(b): every copy and every modified version keeps the attribution "Omatalous, Jouni
Mikkola" and a link to https://github.com/jouni-mikkola/omatalous in the footer of every page of the app.
Versions before 0.66.0 stay under the MIT licence, and 0.66.0 under the Omatalous Personal Use License 1.0.

The Nordea logo in `apps/web/public/banks/` is Nordea's trademark, and the licence does not cover it. The other banks'
logos are fetched from Enable Banking while the app runs and are not in this repository. The notices of all packages in the build are in
`THIRD_PARTY_NOTICES`, also in the image.

If Omatalous is useful to you, you can [buy me a coffee](https://buymeacoffee.com/jouni.mikkola).
