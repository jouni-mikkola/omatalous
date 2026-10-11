# Omatalous

Omatalous gathers a Finnish household's Nordea accounts and credit cards into one view and shows where the money goes.
It runs on your own Linux machine at home, and you use it in a browser, in Finnish.

New transactions come from Nordea through Enable Banking, which is free for your own accounts, or from CSV files.
Omatalous sorts them into spending, loan payments, saving and income, finds recurring bills and warns about double
charges and late fees. Each household member has a login of their own, and accounts can be shared read-only. Your
transactions, bank keys and backups stay on your machine. Nothing is sent to the project.

<img src="docs/images/kuukausi.png" alt="Kuukausi, the first page of Omatalous, with demo data">

## Install

You need Ubuntu Server 26.04 LTS on a machine that stays on at home, with 2 GB of memory and 20 GB of disk.

```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/jouni-mikkola/omatalous.git
cd omatalous
./scripts/install.sh --install-docker
```

On a new machine the installer installs Docker and `jq` and gives your user the Docker right, asking once. If it says
your user has no access to Docker, log out and back in and run the last line again. It then prints a link. Open it on a
device in your home network, create the admin user and follow the setup for connecting Nordea. The
[install guide](docs/INSTALL.md) has the same steps with a few more words.

## More

| When you want to | Read |
|---|---|
| Install step by step, and update later | [Install](docs/INSTALL.md) |
| Understand the two Nordea links, or read an error message | [Connecting Nordea](docs/ENABLE_BANKING.md) |
| Fix something that does not work | [Troubleshooting](docs/TROUBLESHOOTING.md) |
| Use the app away from home | [Away from home](docs/ADVANCED.md#away-from-home) |
| Give your parents or another household a copy of their own | [A second copy](docs/ADVANCED.md#a-second-copy-on-the-same-machine) |
| Back up to a NAS or move to a new machine | [Backups](docs/ADVANCED.md#backups) |
| Know how the money is counted | [Money flows](docs/MONEY_FLOWS.md) |
| Know what is stored, what connects where and who can see it | [Security and privacy](docs/SECURITY.md) |

For developers: [development](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md), [releasing](docs/RELEASING.md)
and the [changes](CHANGELOG.md) in each version. Report a vulnerability as [SECURITY.md](SECURITY.md) says. Issues and pull requests: [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT, see [LICENSE](LICENSE). The bank logos in `apps/web/public/banks/` are the banks' trademarks, and the licence does
not cover them.
