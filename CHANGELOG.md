# Changes

Update with `./scripts/update.sh`, go back with `./scripts/update.sh --rollback`. Database changes run on
start, after a copy is taken.

## Unreleased

- Releases and the return page now come from the public repository `jouni-mikkola/omatalous`: clone URL, image `ghcr.io/jouni-mikkola/omatalous`, signing identity and return page address `https://jouni-mikkola.github.io/omatalous/paluu/`. An existing install moves over by changing its remote, see [OPERATIONS.md](docs/OPERATIONS.md).
- The app is now called Omatalous. Only the visible name changes. Cookie, `TALOUS_*` variables, image labels, backup names, containers and volumes keep their names.
- The installer asks nothing. It binds the app to the machine's home network address (or `127.0.0.1` when that
  address is not private), builds, starts and prints a setup link with the one-time code in it. The access menu
  (home network, this machine, Cloudflare Tunnel, own domain) shows only with `--reconfigure`. New flags:
  `--ops-helper`, `--ops-helper-off`, `--ops-policy`, `--no-ops-helper`.
- *Asetukset > Palvelin > Ylläpito* checks for updates, updates, rolls back, takes and downloads a backup, restarts the
  app and runs a system check. A helper on the machine does the work, once a minute, from a fixed list of six actions.
  Update, rollback and the backup download ask for your password again. Access and port changes stay in
  `./scripts/install.sh --reconfigure`. See [OPERATIONS.md](docs/OPERATIONS.md).
- Updates follow signed releases. A tag `vX.Y.Z` builds an image for amd64 and arm64, signs it with cosign and
  publishes it to `ghcr.io`. `update.sh` verifies the signature, takes the database copy right before the switch and
  goes back by itself when the new version does not start. `TALOUS_CHANNEL=source` keeps the source build. See
  [RELEASING.md](docs/RELEASING.md).
- Bank linking from a plain-http home network address goes through a static return page on GitHub Pages, which
  forwards the browser to your own private address. The paste step stays as the fallback. The wizard starts at
  Enable Banking and tests the Application ID when you save it. Copy works on http. *Lisää seuraava tili* adds the next
  account. The redirect URL to register is in [ENABLE_BANKING.md](docs/ENABLE_BANKING.md).
- `./scripts/doctor.sh` and the system check name the problem and the command that fixes it. They also check the maintenance helper.
- Security: login attempts are counted before the password hash runs and per user name and address, only a few hashes
  run at once, and failed logins, lockouts, new devices, password resets and maintenance requests are recorded as
  security events (90 days) that the admin sees under *Asetukset*. Members get a notice after a login from a new device
  or an admin password reset. Removing a member ends their bank consents first. `sessions revoke-all` signs everyone
  out and `secret rotate` changes the app secret. See [SECURITY.md](docs/SECURITY.md) and the new
  [SECURITY.md](SECURITY.md) for reporting a vulnerability.
- Backups: the app's own copies (`auto-*` and `pre-*`) are deleted after 14 days, apart from the newest `pre-*` copy.
  Copies in `backups/` from `backup.sh` are not touched.
- Upgrade: migrations 0005 (security events) and 0006 (maintenance requests) run on start. A CSV import is limited to 6 MB,
  so a larger export is refused with a 413. An install saved before the trade register setting existed has the lookup
  off after the update. Turn it on under *Asetukset > Palvelin*.
- A CSV imported into a new account after the bank account exists makes a separate account. Import into the bank
  account to avoid counting twice.
- *3 kk*, *6 kk* and *12 kk* are the last whole months. The running month had its bills but not its
  salary yet and made a year look about 1 400 € worse than it was.
- *Kiinteät menot* match what was paid: a monthly fee counts its charges of the last twelve months (day
  care free in July, electricity in winter), and the credit card bill is no longer a fixed cost.
- *Tämä kuu* shows the forecast to month end as a tile. The overview's alerts and insights are fewer and
  about the period: spikes that are one big purchase, Christmas or a summer trip, and swings inside a
  category's usual months, are left out.
- *Raportit* is shorter: the summary and cash flow are one section, the category table has four
  columns, and the category group lines and the savings line are gone. Price changes keep loan
  instalments apart from prices.
- *Tapahtumat* sums money out and in over every matching row. *Kategoriat > Kauppiaat* names a merchant's
  other categories, so a bank's loan instalments no longer read as bank fees.

## 0.3.0

- The installer asks one question (how the app is reached). `./scripts/install.sh --yes` asks nothing and
  reads `TALOUS_ACCESS`, `TALOUS_DOMAIN`, `TALOUS_EMAIL`, `TALOUS_PORT`, `TALOUS_BIND`, `TALOUS_NAME` and
  `TALOUS_TUNNEL_TOKEN` (or the matching flags). `./scripts/doctor.sh` checks an install and says what to fix.
- Images carry a `talous.commit` label, so `update.sh` can tell whether the running image matches the code.
  Images built before this have no label, so the first `update.sh` after upgrading rebuilds once.
- The app exits with a clear log line when the app secret file cannot be read or created. Before, an
  unwritable path such as `/proc/...` left it spinning without output.
- The overview shows the first data quality warning (for example card bills counted as spending), what is
  left of the month in bills and everyday spending, and the date range of a CSV file after import.
- Report totals cover the whole range also when it is longer than the 24 months the tables show.
- The reports page offers a retry when loading fails.
- Several instances on one machine: `./scripts/install.sh --new-instance NAME` makes another clone with its own
  port, containers and data. Existing installs keep their names. Option 4 in the installer binds to a local
  network address. See [INSTALL.md](docs/INSTALL.md#several-instances-on-one-machine).
- The installer no longer sets up Tailscale. An install that already uses it keeps working; its address
  stays under *Asetukset > Palvelin*.
- The session cookie is named after the instance, so two instances on one host no longer log each other out.
  A login from the old cookie still works once.
- *Menot kuukausittain* on the overview: one column per month, the average of complete months as a dashed
  line, and the running month and first month of history hatched. Click a month to see it by category,
  each with a 12-month sparkline, its average and the difference. The table view stays.
- More Finnish billers and card merchant codes are recognised, among them energy, water and waste
  companies, landlords, student housing, unions and unemployment funds (new category *Jäsenmaksut*) and
  wellbeing services counties. Municipal fees fall back to taxes. Rent received is income. Money in from
  card issuers such as Bank Norwegian is borrowing.
- A category comes from, in order: your rules, built-in rules, the card's merchant code, the same
  merchant's other rows, the trade register. A category set by hand never changes.
- Merchants nothing else recognises are looked up in the Finnish trade register (PRH open data) and get a
  category from their industry. Only the merchant name of a business row is sent. The transactions list
  shows a *YTJ* badge with the company. The lookup is on by default and first runs at the hourly tick
  after the update. To keep it off, set `INDUSTRY_LOOKUP=false` in `.env` before updating, or turn it off
  under *Asetukset > Palvelin*. See [SECURITY.md](docs/SECURITY.md#trade-register-lookup).
- Rules are plain words and match whole words, so *VR* no longer matches *Evry Oy*. Regular expressions
  are no longer accepted. Simple ones saved earlier, such as `/^kahvila\s/`, are read as plain words; the
  others stop matching and *Säännöt* marks them *ei käytössä*. *Vaihda kaikki saman kauppiaan
  tapahtumat* replaces the earlier rule for that merchant. A user can have at most 300 rules, rules made
  from the transaction list included.
- One hourly job: bank fetches in the chosen hours (only once when clocks go back and an hour repeats),
  register lookups and cleanup of expired sessions and unfinished bank authorisations.
- Joint accounts are listed once in the household transaction list and export.
- The bank callback passes only a short error code and the page shows its own text. Fetch messages no
  longer show raw bank responses. Caddy drops a `CF-Connecting-IP` sent by the client.
- A failed logout shows an error instead of looking signed out. Account type follows the bank's type code
  before words in the name. Cash flow totals match their rows for ranges over two years. A reprocess that
  read a row before it was set by hand no longer overwrites that category.
- Faster: whole-history loads skip the raw bank data, transfer pairing looks up partners by amount,
  node:sqlite batches reuse prepared statements and the analysis cache shares a build in progress.
- Shorter UI texts, one Finnish term per concept.
- New tables `merchant_industry` and `merchant_industry_users` (migration 0002).
- Two partial indexes for pending and uncategorised rows (migration 0004).
- New column `transactions.search_text` (migration 0003). Search ignores case and treats ä, å and ö as a and o.
- *Luokittelematta* on *Tapahtumat* lists the merchants nothing recognised, largest first. A category
  picked there is saved as a rule for the merchant.
- Register lookups start right after a CSV import or a fetch that brought new transactions, without
  waiting for the next hour.
- *Kategoriat > Kauppiaat* lists your merchants with their category, row count and total. Pick a category
  for a merchant to apply it to all its rows, old and new, or remove the rule to let the automatic
  categories decide again.
- The overview shows alerts: the same charge twice, late fees, overlapping services, a category that
  jumped, subscriptions to review, bank fees and small purchases that add up.
- A running month is compared with the same number of days of the previous period. On 9 October the totals are
  set against 1 to 9 September.
- Payments to Nordea Rahoitus, Bank Norwegian and other card issuers are told apart. A bill that changes
  every month is a card bill and an instalment that repeats is debt. Loan payments to a mortgage lender are
  mortgage payments. MobilePay to a company is spending in its category.
- Imported accounts can be renamed, deleted and given a balance by hand under *Asetukset > Tilit*.
- Transfers between your own imported accounts are recognised. The account number is read from the CSV file.
- Failed logins are limited to 10 per user name and 50 per address in 15 minutes.
- The app copies the database every day to `/data/backups/auto-YYYY-MM-DD.db` in the data volume and keeps
  7 copies ([INSTALL.md](docs/INSTALL.md#backups)).
- `scripts/reset.sh` starts over when nothing else helps
  ([INSTALL.md](docs/INSTALL.md#when-something-is-stuck)).
- Cloudflare Workers support is removed. The app runs in Docker.

## 0.2.0

- Setup in the browser. The installer only asks how the app is reached. Address, time zone, fetch hours,
  history and the Enable Banking key are set on first visit and later under *Asetukset > Palvelin*.
- The Enable Banking key is created on the server. Only the certificate is downloaded, and
  *Tallenna ja testaa* checks it right away.
- The encryption key is created automatically in its own volume.
- *Lisää pankkiyhteys* with Nordea's logo.
- Safe updates: `scripts/update.sh` with rollback, checksummed migrations, a copy before migrating, and an
  old version refuses a newer database. Categories are recomputed after each update.
- Loan accounts (e.g. Asuntolainatili) are recognised. Mortgage payments stay debt.
- Fixes to transfer pairing, user regex rules, MobilePay to people, recurring detection and monthly
  averages, plus many smaller fixes from a code review.

## 0.1.0

- First version: Nordea through Enable Banking and CSV import, money flows, recurring costs, overview,
  reports, several users with shared accounts, Docker install.
