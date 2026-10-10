# Changes

Update with `./scripts/update.sh`, go back with `./scripts/update.sh --rollback`. Database changes run on
start, after a copy is taken.

## 0.5.1

- Updates from the browser and new installs from a release work again. The images of 0.4.0 and 0.5.0 were signed by a
  release run started by hand, and the signature check in `update.sh` and `install.sh` accepted only a run started by a
  push, so it refused them with "Could not verify the image signature". The check now accepts both. From this release on,
  pushing a new version to `main` in the public repository starts the release, so the signature comes from a push that
  installs of 0.4.0 and 0.5.0 accept too. A release started by hand stops unless it is asked for explicitly.
- The release workflow checks each image with the same function installs run. The upgrade rehearsal checks the latest
  release with this version's copy and with the copy in every older version it tests.

Upgrade

- An install of 0.4.0 or 0.5.0 updates with *Päivitä* in *Asetukset > Ylläpito*, also one that stopped at the signature
  check.
- An install made from the public repository on 10 October 2026 before 0.4.0 accepts only a release built from a tag.
  Update it once in its folder with `git pull --ff-only && ./scripts/update.sh`.
- A new install whose `install.sh` stopped at the signature check has no running app. Run `git pull --ff-only` and
  `./scripts/install.sh` again in its folder.
- An install where `TALOUS_CHANNEL=source` was added to get past the check stays on source builds until the line is
  removed from `.env`.

## 0.5.0

Money and reports

- Money that comes back no longer counts as income. A shop refund (within 120 days), a person sending back what you sent
  (within 90 days) and friends' shares of a bill you paid cancel the payment they belong to and take its category. They
  show *palautus* in *Tapahtumat*. Salary, benefits and regular payers stay income. The rules are in
  [docs/MONEY_FLOWS.md](docs/MONEY_FLOWS.md).
- A purchase that came back leaves the largest purchases, the merchant lists, the habit alerts and the double-charge alert.
- New reports: *Tulevat laskut* (bills that are not monthly, due in the next three months), *Nousseet menot* (a category
  above its own level for three months in a row, not one-off spikes) and fixed costs as a share of income, with the
  savings buffer in months where the bank gives balances.
- *Tulot ja menot* no longer calls the running month a loss before its salary arrives. *Uudet kauppiaat* lists shops
  visited at least twice.
- Every merchant and biller name opens its transactions. Filtered to one merchant, *Tapahtumat* shows its whole history
  at the top: totals, number of payments, monthly average, first and last payment, category, and the cadence and next
  date of a recurring payment.

Fetching and importing

- A pending row is replaced by its booked row, also when the bank lists both or a CSV brings the booked one, and keeps
  your category. A CSV import skips a row only when the day, amount and merchant agree, so two shops with the same amount
  on one day are both kept. Amounts are read as exact cents with the bank's sign. A fetch that hits the page limit fails
  and is retried instead of storing a short list.

Look

- One calm theme instead of light and dark: a soft grey-blue page, no white surfaces, a navy primary colour and a chart
  palette checked for colour blindness.
- Empty pages say what to do next, the recurring and accounts tables fit a phone, and "Haku pankista" and "Päiviä ilman
  kulutusta" replace names that were easy to misread.

Reliability

- `node dist/node.js restore <file>` checks a backup before it replaces the database and keeps the current one as
  `pre-restore-*.db`. The app refuses to start empty over a database that lost its tables when copies exist.
- Every database copy (daily, before an update, `backup.sh`) is checked after it is written and removed when it fails.
- A full disk or a busy database shows a Finnish message instead of a generic error. `/api/health` checks the database.
- An import, an upgrade or a fetch stopped by a crash is finished at the next start or within the hour. On shutdown the
  app lets running work finish for up to 8 seconds.
- Changing one category or merchant rule takes about 0.1 s instead of 2 s on a long history, a fetch that brings nothing
  new does no work, memory stays flat (the analysis cache has a size limit), and the server answers during long jobs.

Maintenance

- *Asetukset > Ylläpito* has three more actions. *Lue lokit* shows the last 100 lines of the app and of Caddy or the tunnel, with keys, tokens and bearer headers hidden. *Siivoa levy* runs `docker image prune -f` and `docker builder prune -f`, never touches the running or the previous image and says how much it freed. *Uusi apuri* installs the helper's schedule again from the folder (`install.sh --ops-helper`).
- `update.sh` renews the helper's schedule after a successful update when the helper is on. `install.sh` no longer stops a helper run that is in progress when it replaces the timer.
- The helper protocol is version 2. A version 1 helper still does the old six actions, and the page offers the new ones only after it has updated. Migration 0007 widens the action list in `ops_requests` and keeps every row.
- Developer and release files moved from `scripts/` to `tools/` (publish script, return page hash tool, shell tests, CI checks). `scripts/` now holds only what a household uses. `tools/` stays out of the image. New: `pnpm test:sh`.
- `install.sh` sets `net.ipv4.ip_nonlocal_bind=1` when the app binds to a home network address, so Docker can bind it when the machine gets the address late at boot. The manual step is gone from TROUBLESHOOTING.

For developers

- The upgrade rehearsal includes 0.4.0 and checks that each old version's maintenance helper accepts the new
  `docker-compose.yml` (`tools/ci/compose-compat.sh`), because installs update through the helper they already run.
- README shows what connects where.

Upgrade

- Nothing to do by hand. *Päivitä* in *Asetukset > Ylläpito* updates from 0.4.0.
- Migrations 0007 (the maintenance request table gets the new actions) and 0008 (indexes) run on the first start, after
  the usual copy. The indexes take a few seconds on a long history.
- The helper runs from the updated folder, so its new actions show up within a minute after the update.

## 0.4.0

- A release can be started by hand from the public repository's Actions tab. That run creates the version tag itself.
  Installs accept images signed by such a run on `main` as well as by a tag run.
- The code is MIT licensed, see [LICENSE](LICENSE). The bank logos in `apps/web/public/banks/` belong to the banks and are not covered.
- README, INSTALL, ADVANCED (replaces OPERATIONS), TROUBLESHOOTING and ENABLE_BANKING are rewritten. The basics come
  first, the rest is sorted by situation.
- Script, command-line and log output is in English. The web app stays Finnish, and so do the update reports and
  the system check on the *Ylläpito* page. Prompts take y or n, and the Finnish k still works.
- The installer installs `jq` by itself where `apt-get` and root rights are available, because the maintenance helper needs it.
- `install.sh` now saves the app's own address when a run chooses the access or address (`--reconfigure`, `--bind`,
  `--access`, `--domain`). Before, the address kept its old value after the setup. New command:
  `node dist/node.js address set <url>`.
- A release needs no approval step. A tag `vX.Y.Z` on the public repository builds and publishes it.
- Releases and the return page now come from the public repository `jouni-mikkola/omatalous`: clone URL, image `ghcr.io/jouni-mikkola/omatalous`, signing identity and return page address `https://jouni-mikkola.github.io/omatalous/callback/`. An existing install moves over by changing its remote, see [RELEASING.md](docs/RELEASING.md#moving-an-install-from-the-private-repository).
- The app is now called Omatalous. Only the visible name changes. Cookie, `TALOUS_*` variables, image labels, backup names, containers and volumes keep their names.
- The installer asks nothing. It binds the app to the machine's home network address (or `127.0.0.1` when that
  address is not private), builds, starts and prints a setup link with the one-time code in it. The access menu
  (home network, this machine, Cloudflare Tunnel, own domain) shows only with `--reconfigure`. New flags:
  `--ops-helper`, `--ops-helper-off`, `--ops-policy`, `--no-ops-helper`.
- *Asetukset > Ylläpito* checks for updates, updates, rolls back, takes and downloads a backup, restarts the
  app and runs a system check. A helper on the machine does the work, once a minute, from a fixed list of six actions.
  Update, rollback and the backup download ask for your password again. Access and port changes stay in
  `./scripts/install.sh --reconfigure`. See [ADVANCED.md](docs/ADVANCED.md#the-maintenance-helper).
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
- Upgrade from 0.3.0 or older: migrations 0003 (search text), 0004 (partial indexes), 0005 (security events) and 0006
  (maintenance requests) run on start, after a copy of the database. Search text and categories are recomputed once.
  A CSV import is limited to 6 MB, so a larger export is refused with a 413. An install saved before the trade
  register setting existed has the lookup off after the update. Turn it on under *Asetukset > Palvelin*. `.env` gets no
  new required keys. `INSTANCE_NAME`, `COMPOSE_PROJECT_NAME`, `HOST_PORT`, `BIND_ADDRESS` and `CADDY_ADDRESS` are
  optional, and an install without them keeps `banking-app`, its port and its volumes. To get signed updates, point the
  clone at the public repository, see [RELEASING.md](docs/RELEASING.md#moving-an-install-from-the-private-repository). Linking a bank through the return page needs
  `https://jouni-mikkola.github.io/omatalous/callback/` as the redirect URL in the Enable Banking application, see
  [ENABLE_BANKING.md](docs/ENABLE_BANKING.md). The paste step needs nothing new.
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
  network address. See [ADVANCED.md](docs/ADVANCED.md#a-second-copy-on-the-same-machine).
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
  7 copies ([ADVANCED.md](docs/ADVANCED.md#backups)).
- `scripts/reset.sh` starts over when nothing else helps
  ([ADVANCED.md](docs/ADVANCED.md#start-over)).
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
