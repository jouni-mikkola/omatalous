# Changes

Update with `./scripts/update.sh`, go back with `./scripts/update.sh --rollback`. Database changes run on
start, after a copy is taken.

## 0.8.6

Money and reports

- Tapahtumat no longer counts own transfers in the paid and received sums, and a merchant's summary leaves them out of its totals and its category. The page says so.
- A merchant's figure per month is the same on Laskut, Kauppiaat and the merchant summary: a recurring payment shows its own price, any other merchant the average of its last twelve complete months.
- Laskut: Sopimukset ja laskut no longer counts a monthly saving, so it and Tilaukset add up to the fixed costs on top. Monthly savings have their own card.
- Harvinaiset laskut shows a bill paid this month as paid, with its date, and lists only the months that have bills.
- A search that reads as a euro amount, such as 142,30, also finds the rows of that amount.
- *Raportit > Kategoriat* lists a category that had spending in the previous period only, at 0 € now, and ends with a *Yhteensä* row. The changes now add up to the change in spending.
- *Menojen muutos* on *Kuukausi* shows no bars when no category stands out. Before, one *Muut* bar held the whole change while the table's *Muut* row showed a different figure. The rest bar is now called *Muut muutokset*.
- *Raportit > Tulot* is titled *Tulot, 12 kk*, because it always covers the twelve months up to the last complete one, whatever the period. The figure is *Nettotulot*, the money that reached the accounts. Ansiotulot is the gross figure of taxation, so the old label was wrong. The month count follows the history: Viime vuosi of a history from September reads 4 months.
- The month rows of *Raportit* (Tulot ja menot, Kuukausitaulukko, Kiinteät ja muuttuvat, Tulot) start where the history starts. Before, the months before the first transaction showed as partial months of 0 €.
- *Ennuste kuun loppuun* needs one complete month. Until then the card shows what has gone and the bills still due, and says on which day the forecast appears. Before, the "forecast" was only what had been spent.
- *Tämä kuu* tells last month's income in one line that links to *Viime kuu*, instead of repeating its whole *Mihin tulot menivät* card. On a first run with one partial month, that month's income is shown, marked *vajaa*. Before, the page said there was no income.
- The *Menot kuukausittain* link and the income link on *Kuukausi* open *Raportit* at that section.
- *Säästövinkit* tells each euro once: an insight under *Muut havainnot* goes when the tips together already tell most of it, or when what is left of it is under the 120 € gate. On the demo, "Kaksi toistuvaa maksua kallistui, yhteensä 168 €" no longer repeats Adobe's rise and Netflix from the video tip.
- The headline reads "Säästömahdollisuus noin 288 € vuodessa, 2 vinkkiä". *Tilanne* counts only the checks that ran and says how many wait for data or a longer history.
- The areas without tips are two folds: the ones checked without findings, and the checks that wait for a number, more data or a longer history, listed apart.
- *Velanhoito tuloista* says that its 35 % line is the app's own, not an authority's recommendation.
- *Muut havainnot* show what their figure is ("Maksaa 276 € vuodessa", "Nousu 168 € vuodessa") apart from the tips' euros, with what to do.
- A tip you asked to be reminded of later keeps its name and euros under *Päätetyt*.
- A subscription that moves to another card or account is no longer told as a new regular payment.

Fetching and importing

- Connecting the bank takes fewer clicks. The certificate downloads by itself when the key is made, and an Application ID whose test passes is saved without a button press while no app is saved yet.
- Lisää pankkiyhteys in the first-run setup and the bank tile under Asetukset > Pankkiyhteydet stay on while the app reads Inactive. Starting a connection tests the app again and says what is wrong.
- Asetukset > Oma Enable Banking -sovellus shows the privacy and terms addresses the Control Panel asks for, with copy buttons. Saving a key pair tests it against Enable Banking, and a pair it refuses is not saved.

Look

- *Asetukset > Talouden jäsenet* has a *Kopioi ohje* button beside a new member's temporary password. It copies the address of the app, the username, the password and a line saying the password must be changed at the first login.
- The install guide is shorter. `./scripts/install.sh --install-docker` installs Docker and `jq` and gives the user the Docker right, so only `git` is installed by hand.

Reliability

- Login limits hold against a client that keeps changing its address. An IPv6 address counts as its /64, and one user name gets at most 30 failed logins in 15 minutes from all addresses together. Each limit holds at most 10 000 addresses or names in memory.
- A `SETUP_CODE` shorter than 16 characters is not used. The app says so at start, and a generated code works instead.
- The Cloudflare Tunnel container runs with a read-only file system and no Linux capabilities.

Maintenance

- `./scripts/backup.sh --schedule [HH:MM]` puts the daily backup in the crontab (03:30 without a time) and `--unschedule` takes it out. A second run replaces the line, and other folders' lines and your own stay. `doctor.sh` names it when there is no recent backup.
- `backup.sh` reads `BACKUP_AGE_RECIPIENT` from `.env` when the shell has none. The scheduled backup and the *Varmuuskopio* button under *Asetukset > Ylläpito* run with an empty environment, so until now they never encrypted or saved the app secret.
- `BACKUP_COPY_TO` in `.env` is a folder, for example a mounted NAS share. Each new backup is copied there when the folder is on a mounted drive and writable. Otherwise `backups/backup.log` gets a warning and the local backup stays.
- `node dist/node.js cloudflare up --name <copy> --hostname <host>` puts a copy behind a Cloudflare Tunnel and Cloudflare Access (Zero Trust Free). Only the email addresses you list can sign in, with a one-time PIN, before the app's own login. It needs no database. The API token and the addresses come from the environment, a second run changes nothing, and `cloudflare down` removes what it made.
- The installer can make a copy's Cloudflare tunnel, its address and its Cloudflare Access rule by itself. Put an API token, a domain on your account and the default email addresses in `~/.config/omatalous/cloudflare.env` (mode 600) once, then run `./scripts/install.sh --access tunnel`. A copy from `--new-instance NAME --access tunnel` gets the address `NAME.<your domain>`; a first install is asked (`talous.<your domain>` by default) and with `--yes` needs `--domain`. An address another copy with the same file already has is refused.
- Each copy has its own list of addresses that Access lets in. Give it with `--access-emails a@example.fi,b@example.fi` (or `TALOUS_ACCESS_EMAILS`), or accept the file's list. It is kept in the copy's `.env` as `CLOUDFLARE_ACCESS_EMAILS`. Running `./scripts/install.sh --access-emails ...` in the copy's folder changes the list.
- `./scripts/install.sh --cloudflare-down` removes the tunnel, the address and the Access rule of the copy in that folder.
- A tunnel made by hand works as before: no file, or `TALOUS_TUNNEL_TOKEN` given.
- `./scripts/cloudflare-setup.sh` writes the Cloudflare settings file (`~/.config/omatalous/cloudflare.env`, mode 600) for tunnel access. It asks for the API token without showing it, checks the token with Cloudflare, takes the domain from the token's zones and asks which emails may log in. Run it again to change a value: it offers the saved domain and emails and keeps the token unless you type a new one.
- `./scripts/restore.sh <file>` restores a backup in one command: a `.db` downloaded with *Lataa uusin*, or a `.db.gz` or `.db.gz.age` made by `backup.sh`. It stops the app, restores the file with the usual check, starts the app again and writes `APP_BASE_URL` from `.env` as the app's address. `--secret <file>` puts the app secret back and keeps the old one as `.prev-<time>`. A file that is not a database is refused before the app stops, and a failed restore starts the app again.

For developers

- `CONTRIBUTING.md` says how to open an issue or a pull request and how to report a vulnerability.
- `docs/ARCHITECTURE.md` lists every table, and the docs name the Säästövinkit page and *Asetukset > Tilit* as the app does.
- `recurring.ts` was at its 570-line cap and is now about 370 lines. The cadence table and its fit, the series' cost and the input charges moved to `recurring-cadence.ts`, `recurring-cost.ts` and `recurring-occurrence.ts`. Everything `recurring.ts` exported is still importable from it, and no finding or figure changes.
- The public repository no longer carries the maintainers' worker guide and worker tools, and a snapshot that still names a file, commit or plan of the private development repository stops before anything is published.
- `pnpm check` names the three slowest tests over 2 s under the test summary, so one near vitest's 5 s timeout shows before it fails.
- The tests that load a frozen release database write it without a flush per statement. Their five files take 20 s of test time in a full run instead of 68 s, and `contracts.test.ts` no longer runs a test near the 5 s timeout.
- `release.sh` writes `contracts/X.Y.Z/` and the frozen database of a release that adds migrations, where the 0.8.5 release stopped for them: the helper files copied from the previous folder, a README worded from what the migrations add and the compat floors they carry, the schema and the fixture. It still stops where the helper files changed since the last release, because a person checks those.

Upgrade

- Two optional `.env` keys, `BACKUP_AGE_RECIPIENT` (an age public key) and `BACKUP_COPY_TO` (a folder). `backup.sh` reads them from `.env` when the shell has none. With a key in `.env` the *Varmuuskopio* button now encrypts.
- A `SETUP_CODE` in `.env` shorter than 16 characters is no longer accepted. Set a longer one, or remove it and get a code with `docker compose exec banking node dist/node.js setup-code`. It matters only before the first user exists.

## 0.8.5

Money and reports

- A shop or service paid with MobilePay (MOB.PAY* on the bank row) is the same merchant as when it is paid by card, so a subscription paid either way is one subscription.
- A new streaming, audiobook or software subscription shows among the fixed costs after its second monthly charge of the same price, a month sooner than before.
- *Säästövinkit* shows the insights that were on *Kuukausi* and in *Raportit > Havainnot* as *Muut havainnot*, answered with the same *Ei koske meitä* as the findings. An insight that a finding already tells is left out, and a dismissed one returns when its figure moves 25 %.
- One *Päätetyt* list holds every answer with its state (*Tehty*, *Ei koske meitä*, *Muistutus*) in place of three lists.
- The areas without findings fold into one line, with what was checked behind it.
- A subscription marked *Lopetettu*, or *Käytössä* within the past year, has no subscription finding or insight. A price rise still shows when *Käytössä* was marked before the new price.
- With *Säästövinkit* switched off, the insights stay on *Kuukausi* and in *Raportit > Havainnot*.

Fetching and importing

- Accounts are named by the bank's product (Käyttötili, ASP-tili, Nordea Gold) instead of the holder's name. The holder is a line of its own under the name in *Asetukset > Tilit*, which also shows the IBAN in groups of four, a card's last four digits and its credit limit.
- Any account can have a name of your own in *Asetukset > Tilit*. A new bank consent or a fetch never replaces it.
- A current account whose product is a savings product (Säästötili, ASP-tili, Tuottotili, Sijoitustili) is read as a savings account when it is linked. A type you chose stays.
- *Asetukset > Pankkiyhteydet* lists the accounts each connection reads with their IBAN, so two connections of one holder differ. A connection that has not fetched yet says why: waiting for the first fetch, or the account is not linked in the Control Panel.
- The product, holder, card number and limit of accounts that are linked already arrive when their bank consent is renewed.

Maintenance

- *Ylläpito* no longer offers the version that was just installed.

For developers

- `wait.sh` ignores skipped check runs.

Upgrade

- Migration 0013 runs on the first start, after the usual copy. It only adds columns, so a rollback to 0.8.0 or later keeps the data.

## 0.8.4

Money and reports

- A category given to one row without a merchant name changes only that row, no longer every unnamed row. *Kauppiaat* has no category choice for *Tuntematon*, and a rule an older version made for it is removed on the update.
- *Kuukausi > Viime kuu* tells why the month differed with *Menojen muutos*, in place of the month table. *Raportit* no longer shows it.
- *Ennuste kuun loppuun* holds the month's pace chart (*Kuukauden kulku*) and says what is usual so far.
- The month columns and the merchant list left *Kuukausi*. A link leads to *Raportit* for the months side by side and one to *Tapahtumat* for the month's merchants.
- A month has one usual total. *Menojen muutos* says the same *tavallisesti* as the forecast and the pace chart, the median of the month totals. What a usual month spends beyond the categories' own levels is in *Muut*, so the *Tasauserä* row is gone.

Look

- The first page is called *Kuukausi* and the page of findings *Säästövinkit* (also its switch in *Asetukset > Palvelin*). The addresses stay the same.
- A period belongs to one page. *Kuukausi* offers *Tämä kuu* and *Viime kuu*. *Raportit* offers *3 kk*, *6 kk*, *12 kk*, *Tämä vuosi* and *Viime vuosi*. An old link with a period the page does not have opens the page that does.
- Fourteen help lines under headings and figures are gone where they only repeated what the page shows.
- The two logs are named *Turvallisuusloki* (*Asetukset > Turvallisuus*) and *Ylläpitoloki* (*Asetukset > Ylläpito*).
- *Tulot ja menot* no longer repeats its figures in a tile row above *Mihin tulot menivät*. *Kiinteät ja muuttuvat* leaves out a part that is 0 €. *Nousseet menot* appears only when a category rose.
- *Toistuvat* is now *Laskut* (`#/bills`). The old address opens it. A line on top says the fixed costs a month and how much of them is subscriptions.
- *Tulossa* is one list of the bills of the next 30 days: those the bank history shows, rare ones and those you typed in. *Lisää lasku* opens the form there. Its sum is the *Menoja* figure of *Seuraavat 30 päivää* on *Kuukausi*, which now links to the list and no longer lists the bills itself.
- *Tulevat laskut* in *Raportit* is *Harvinaiset laskut* on *Laskut*: the next twelve months and the bills you typed in. The list of three months is gone. *Hinnanmuutokset* moved there too and is shown only when a price changed.
- On *Laskut* the cards *Sopimukset* and *Laskut* are one, *Loppuneet* is folded, and the *Arkiostot* and *Tulot* cards and the four tiles are gone. *Arkiostot* is now a filter in *Tapahtumat > Kauppiaat*.
- *Kategoriat* is gone from the menu. Its merchants are the tab *Kauppiaat* of *Tapahtumat*, with the rules under the table. The old addresses (`#/categories`, `#/rules`, `?tab=rules`) open it, the rules ones at the rules.
- *Kauppiaat* adds up a period you choose with *Alkaen* and *Asti*, and has a column *Kuussa*: the money out divided by the months of the period. The filter *Arkiostot* keeps the merchants you buy from often in small amounts. A merchant's link opens its transactions for the same period.
- *Asetukset* is a link in the header beside the user menu, no longer a menu entry. The menu is *Kuukausi*, *Laskut*, *Tapahtumat*, *Raportit* and *Säästövinkit*, and the five labels fit one row on a phone.
- *Asetukset* has two tabs. *Omat* holds your bank connections, accounts, CSV import, sharing and *Kirjautuminen*. *Talous* (administrators) holds the members, *Palvelin*, *Turvallisuusloki* and the way to *Ylläpito*. *Oma Enable Banking -sovellus* shows only when the household has no shared application, and *Esimerkkitiedot* only when there are no accounts or demo data is loaded.
- *Kirjautuminen* has the password form and your signed-in devices. *Vaihda salasana* in the user menu opens it. The old security page (`?section=security`) opens *Kirjautuminen* for a member and *Turvallisuusloki* for an administrator. `?section=server`, `?section=csv` and `?add=1` work as before.
- *Tietojen laatu* is under *Tilit* in *Asetukset* and no longer a card in *Raportit*. The links from *Kuukausi* and *Säästövinkit* go there. Its table of accounts is gone, because *Tilit* shows the same accounts and fetch times.
- *Ylläpito* without the helper shows the notice and the version, and folds the controls that cannot work.
- *Yhdistä uudelleen* is on the row of a bank connection that has ended, broke or ends within two weeks, and starts the same bank again at once. The notice on top links to the bank picker. The button that adds a connection always reads *Lisää pankkiyhteys*.

Maintenance

- The maintenance helper starts on a fresh Ubuntu. The installer takes group and other write away from `.git` as well, which the helper's safety check refuses (Ubuntu's umask 002 makes it group writable).
- When the user's systemd manager started before the user joined the docker group, a timer cannot reach Docker. The installer then uses cron, or sets the timer and tells you to run `sudo systemctl restart user@<uid>.service` or reboot. Its last line about the helper says which happened.
- `./scripts/doctor.sh` reports both problems with the command that fixes them, and no longer repeats an old refusal from the helper log after a later run passed the checks.

For developers

- `prepare.mjs --check-docs` also wants `contracts/X.Y.Z` when migrations were added.
- `GET /api/reports?reports=a,b` builds only the named reports. Kuukausi and Raportit ask for the reports their sections read (`reportsOf` in `pages/reports/registry.ts`).
- `usualSpending(ctx, month, day)` and `usualSpendingOver` own the usual total of a month, also of its days so far. The pace chart and the change report's usual view read them.
- The month explanation (`analysis/explain.ts`) and the dashboard's `trend` and `merchants` are gone.
- README says what Omatalous is, shows *Kuukausi*, gives the install command and links to `docs/`. The diagram of what connects where moved to [SECURITY.md](docs/SECURITY.md#network).
- The Enable Banking steps are in the app's setup. [ENABLE_BANKING.md](docs/ENABLE_BANKING.md) keeps why Nordea is linked twice, the error messages and a member's own app. The error rows moved there from `docs/TROUBLESHOOTING.md`.

Upgrade

- If the helper never ran after a fresh install, run `./scripts/install.sh --ops-helper` again.

## 0.8.3

Money and reports

- The spending change names a category or calls a month dearer or cheaper only when the change stands out from that category's own month-to-month noise, and its usual level leaves out one-offs. A card that has not synced no longer reads as purchases left out.

Fetching and importing

- A bank connection that owns no account any more moves under *Aiemmat yhteydet* in *Asetukset > Pankkiyhteydet*, with *Poista listalta*. Reconnecting moves the accounts, so the old connection and its notice go at once.
- A connection whose date passed reads "vanhentui 9.4.2027". One the bank or Enable Banking closed before its date reads "katkesi" with *Yhdistä uudelleen* and no date. The table, *Tietojen laatu* and the notice use the same words.
- An account the Enable Banking app may not read says "tiliä ei ole linkitetty Enable Bankingissa" and where to link it, also on its row under *Asetukset > Tilit*. One failing account no longer stops the others.
- Connecting with an app that is not active yet stops before the bank with one message, and the bank picker says so. A refusal from Enable Banking or the bank while connecting says who fixes it, and a pasted error address gets the same message.
- An account that a new connection of the same bank did not bring says "<account> ei tullut mukaan uuteen yhteyteen" and points to *Link accounts*, on its row, in *Tietojen laatu* and in the notice, instead of "katkesi".
- Step 2 of the Enable Banking setup (the first-run wizard and *Asetukset > Palvelin*) lists the fields of Enable Banking's "Add a new application" form in the form's order. Each value has a *Kopioi* button, and *Avaa Enable Banking* opens the Control Panel.
- The return page site has a privacy page and a terms page for the form's two URLs. They are shown with the other values.
- *Tallenna ja testaa* and *Testaa yhteys* also read whether Enable Banking counts the app as active. An inactive app gets the line "Sovellus ei ole vielä aktiivinen" and no bank can be connected until the test finds it active.
- A Nordea card's first fetch no longer fails with error 400 when the bank refuses two years of history. The fetch asks again for the last 12 months, then 90 days.
- A failed fetch names the bank's error code next to the status, such as `400 (ASPSP_ERROR)`.

Look

- Asetukset and Asetukset > Ylläpito drop a few help lines that only repeated what the page shows, and the rest read shorter and plainer.

For developers

- `oneOffs(rows, policy)` in `analysis/one-offs.ts` owns one-offs: the level policy for insights, the month explanation, the change report, Optimoi and the spike alert, the pay policy for income (ADR 0005).
- `monthEnd`, `dateIn`, `addMonthsToDate` and `DAYS_PER_MONTH` live in dates.ts; `shiftMonth` and `yearEarlier` are gone. Rules 18 and 19 guard month ends and usual windows.
- The change report reads noise per category (`change-signal.ts`) and cuts a comparison at the day a lagging account reaches (`rowsCompleteThrough`).

## 0.8.2

Money and reports

- Usual income leaves out money from people and refunds everywhere: Kiinteät ja muuttuvat gives the same fixed costs share as the insights and Optimoi's Tilanne, and its "Vapaaksi jää" is that income less the fixed costs.
- The overview compares a month's earned income with the usual income. A month with money from people or refunds names that figure Ansiotulot.
- A subscription's cost a year is its own charges a year in the renewal and new subscription insights and in Optimoi's renewal gate, so a yearly price is no longer rounded through a month (200,04 € reads 200,00 €).
- The follow-up of a done Optimoi decision no longer reads an unchanged fee with a free month, such as day care in July, as dearer.
- Toistuvat: "Tulossa tässä kuussa" counts every date of a weekly or biweekly payment, so its total matches the overview's forecast.
- Electricity from Lumme and Nordic Green is sorted as a utility bill, and Loiste and Herrfors bills are read as electricity sellers on Optimoi.
- Payments from Pensionsskyddscentralen and Elo keskinäinen are sorted as benefits, and a day care name inside a longer word as children.
- A second phone line, a move to a dearer flat and a day-care fee that follows care hours are no longer told as price rises.
- A newspaper paid for a year at once is no longer told as a stopped payment that frees money.
- Grocery visits on a card that stopped syncing are no longer told as fewer visits.
- The grocery, spending growth and dearer month insights and the category spike alert keep quiet when the change is within the household's own month-to-month swings.

For developers

- `pnpm findings` prints every statement the product makes about money (insights, alerts, Optimoi findings and their follow-up, income changes, spending change sentences) with its figure and calc, for the demo and seeded households. `--event <id>` shows a life event on the kit's household, `--golden` rewrites the golden files.
- Golden files in `packages/core/test/golden/` hold what each source says, and a test compares them. A changed golden is part of the change to review.
- The life-event kit in `packages/core/test/kit/` adds 17 events reviewers caught false findings with (a move, a second phone line, a sync lag, a cadence change and others) to a steady household. Each event may only add the statements it allows. A noise budget lets a detector that compares two windows fire on at most 1 % of 200 steady households. Today's failures are listed in `known.ts`, which may only shrink.
- Decision records start in `docs/adr/`.
- Faster checks while working: `pnpm check --changed` runs types incrementally and only the tests and shell steps a diff can affect. Checks wait for a free slot (two at a time), seeded tests have a 30 s timeout and a timeout is reported as one.
- New tools: `tools/commit.sh` (retries a signing 503, never commits unsigned), `pnpm where <symbol>` and `pnpm shots <route>`. Test files over 800 lines are capped by a repo rule.
- `tools/ci/wait.sh <sha> <check>...` waits for named GitHub checks.
- `pnpm release:fixture X.Y.Z` writes the frozen database fixture of a release from the previous one, the current migrations and seed rows for each new table. `tools/ci/verify-release.sh --pull X.Y.Z` checks that the image pulls without a login for amd64 and arm64.
- One owner per figure (ADR 0004): `usualIncome`, `usualSpending` and `gateFor` live in `analysis/usual.ts` over one earned-income predicate, `isEarnedIncome` in `analysis/income.ts`. `cancelledMerchants` and `expectedCharges` moved to `commitments.ts`, `SUBSCRIPTION_CATEGORIES` to `categories.ts` and the fee predicates to `analysis/fees.ts`, with no re-export under the old paths.
- Repo rule 17 keeps `365.25 /` in `recurring.ts`: a series is costed with its own `perMonth`, `monthlyCents` and `yearlyCents`.
- Routes parse, call one service and answer (ADR 0006). `services/optimise.ts`, `services/accounts.ts` and `services/rules.ts` own the writes and the reprocess or version bump. A missing row throws `NotFound`, answered once as 404.
- Every request body goes through `strictObject` or a `parse*` function (repo rule 14). A body with an unknown field, or `createRule: "false"`, is a 400. Dates use one `parseIsoDate`, which refuses 2026-02-30.
- The contract test lists every non-GET route as moving the data version, read per request, or not about the analysis.
- One `Section` card component with a labelled region. Optimoi response types live in core (ADR 0007).
- Repo rules: no runtime import cycle (6d), no mark subject parsing in the web app (15), no core threshold written into a web sentence about history (16). The import boundary baseline is empty.
- Payee, keyword, issuer, lender and tax word lists and the card and industry code sets live in `wording.ts` and `industry.ts` behind named predicates, and `categorize.ts` reads the same constants. Repo rule 21 keeps keyword lists in the dialect files, with a baseline that only shrinks (ADR 0008).
- `seriesId` and `parseSeriesId` in `recurring.ts` are the one maker and reader of a series id; stored ids keep their form (ADR 0009).
- An Optimoi area imports no other area (rule 6); what areas share is in `optimise/common.ts`. `db/optimize.ts` is now `db/pragmas.ts`.
- `analysis/signal.ts` holds the one test every two-window statement passes: a change must stand 4 standard errors out of the household's month-to-month noise (the mean moving range of its monthly series). The growth, grocery, seasons and spike detectors and Optimoi's food and habit areas use it (ADR 0011).
- `notAPrice` in `insights/prices.ts` is the one rule for steps that are no price rise; the price insight and Optimoi's subscription and housing areas read it, and the kids area shares its municipality test. `paysAhead` in `insights/stopped.ts` is shared with the follow-up.

## 0.8.1

For developers

- The release image builds the app once on the build machine's own platform and copies the result into the amd64 and arm64 images. The arm64 install under QEMU had crashed and hung the 0.7.0 and 0.8.0 release builds.
- The release workflow stops a build that hangs after 15 minutes, so *Re-run failed jobs* can retry it with the same push.

## 0.8.0

Money and reports

- Optimoi is a new page after Raportit. It lists what the household could change, each with euros a year computed from its own complete months, or a date to decide by, and how certain the figure is. A finding is shown from 120 € a year, at most three per area, and the total at the top counts each saving once.
- Its 13 areas check the mortgage margin against sample offers, prepaying the mortgage from savings beyond three months of spending, card interest, money left on the checking account, price rises of phone bills and subscriptions, overlapping services, yearly renewals, the Nordea card tier and late fees, the electricity price per kWh, a vastike or rent rise, an insurance premium rise and its renewal, eating out, delivery and repeat small purchases against a year earlier, months that were dear two years running, the household deduction, the day-care fee and parking against a resident permit.
- Some checks need a number you type in, such as the loan margin, the yearly kWh or a resident permit price. The page lists what each number unlocks.
- Outside figures (Euribor, Statistics Finland's electricity prices, the rent index, CPI, Nordea's price list, the household deduction) carry their source and date. An expired figure hides its comparison until a release updates it.
- Each finding opens its calculation, the rows it stands on and its months. Tein tämän, Ei koske meitä and Muistuta myöhemmin are kept for each member separately.
- A done change is followed from the months after it: Jo hoidossa says whether the saving shows and how much it is a month, and waits while the data cannot tell yet. When the data shows a switch, the page asks you to confirm it and never marks it done by itself. The page also lists what changed since the last visit.
- The demo data shows two findings: a software price rise and two video services at once.

For developers

- `packages/core/src/optimise/`: `buildOptimise` applies the rules every finding follows (complete months, the 120 € gate, certainty steps, the user's decisions, three per area, a headline without overlapping claims). `areas/` has one file per area, `facts/` dated outside figures that expire (`factOn`), `inputs.ts` the typed inputs and their validation, `outcome.ts` and `snapshot.ts` the follow-up.
- The price rise, renewal, fixed-cost share, debt share, late fee, overlap, bank fee, habit and expensive month detectors are exported (`priceRiseItems`, `renewalItems`, `commitmentsShareOf`, `debtShareOf`, `isLateFee`, `isLateFeeAlone`, `overlapGroups`, `isBankFee`, `habitItems`, `expensiveMonthItems`), so Optimoi and the overview read the same numbers. `reports/balances.ts` exports its day walk (`balanceWalk`, `lowestDayBalance`).
- `GET /api/optimise`, `GET /api/optimise/evidence`, `PUT` and `DELETE /api/optimise/inputs/:key` and `PUT /api/optimise/findings/:id`, behind the `optimise` flag (stage preview, on by default). Inputs, decisions and snapshots are read for each request like marks, so saving one moves no data version. The first request of a month stores a snapshot, and the response carries `changes` and `followUp`.
- A decision and an insurance quote follow a merchant whose name is derived again on an upgrade, as marks do.

Upgrade

- Migration 0012 adds the tables `optimise_inputs`, `optimise_states` and `optimise_snapshots`. It only adds tables, so 0.7.0 still opens the database after a rollback.
- Optimoi is on after the update. An admin can switch it off in Asetukset > Palvelin.

## 0.7.0

Money and reports

- The savings rate is the money set aside divided by income. It used to be everything left after spending, which counted money that only stayed on the checking account.
- The cash flow CSV ends with a new column, Yli jäi €: income minus spending minus savings.
- The fixed column of Kiinteät ja muuttuvat now holds loan instalments too, like the fixed costs on the overview. Other debt service shows apart as Muu velanhoito, and the parts add up to the spending.
- Rows that say only Vipps are recognised like MobilePay rows: a payment to a person counts as a payment to people, a payment to a company as what it bought.
- The month table under Menot kuukausittain explains the month. It sets each category against its usual level (the median of the last six complete months), names the five that moved most and says why when the data shows it: one large payment, a bill that came twice or not at all, a new recurring charge. A running month is compared with the same days of the usual months. With fewer than three complete months before it the table says when the explanation will appear.
- The dashed line in that chart shows the usual level, Tavallisesti, in place of the average. The row for the smaller categories is called Muut.
- Tulot ja menot has a bar that splits the income into Kulutus, Velanhoito, Säästöön and Yli jäi, with a table view. Its figures give Säästöaste and Yli jäi, the last column of its table is Yli jäi, and a month the history does not fully cover reads vajaa.
- The margin and savings rate of a period with a running month count complete months only, so a first month that starts late in the history no longer skews them.
- A single month shows no swing insights and no largest purchase, since the month explanation tells both. A swing in a longer period must move at least 2 % of the period's spending.
- The Toistuvat page has one Tilaukset total. The tile, the card header and the rows use the same definition: fixed-amount services such as streaming, fitness, education and software, with contracts such as telephone, insurance, housing and loans kept apart under Sopimukset (formerly Vakiomaksut).
- Each subscription shows what stopping it saves in a year and has the buttons Käytössä and Lopetettu, with Kumoa. A subscription marked as cancelled leaves the total, the Kiinteät menot tile and the list of charges still to come.
- Käytössä stops the question about a subscription on the overview for twelve months. Lopetettu stops it for good. If the merchant charges again more than three days after you marked it as cancelled, the overview warns about it.
- The question about a forgotten subscription names the cost per month and per year: "Elixia 59 €/kk, 708 € vuodessa. Käytätkö vielä?".
- The forecast for the month shows a range, for example 3 000–3 200 €. It is the forecast plus and minus how far the same forecast was off on your own last six complete months. With fewer than three such months it uses the typical error of test households and the tile says so.
- The line the month is compared with is called Tavallisesti: for each day, the middle value of the last six complete months. It was the average of three. With fewer than three complete months there is no line.
- The overview lists the next 30 days: pay days, subscriptions and bills, and the bills you typed in. A subscription you marked as cancelled is left out. With a checking account balance it also shows the balance day by day after the usual everyday spending, with its lowest point, so you see when to move money before pay day. Without a balance the tile points to Asetukset > Tilit.
- Tulevat laskut tells how much to set aside each month for bills that do not come every month, for example "Varaa 47 €/kk, harvinaiset laskut ovat 564 € vuodessa." It also lists what falls due in each of the next twelve months.
- A bill the bank history cannot know yet, such as a yearly tax or insurance, can be added by hand on Tulevat laskut with a name, an amount, a due date and how often it repeats. It counts with the bills found in the history and is left out once the history finds the same bill.
- Tulevat laskut is always on the Reports page. Before, it appeared only when the history had found a rare bill.
- A running month gives no monthly average. Categories and the monthly table show no average until a month in the range is complete, and the CSV files leave those cells empty. The column reads Keskimäärin kuussa.
- The monthly table names a month that is not whole "vajaa" and leaves it out of the shading. Categories show each group's share of spending and of income.
- Vuosivertailu appears once three whole months of both years can be compared. One month was enough before and gave a percentage from a single month.
- Nousseet menot stays on the page. Without enough history it says from which day it works, and with a quiet history it says how many categories it compared.
- Tietojen laatu is always shown. It lists the accounts in the figures with their last fetch and the end of the bank consent, and it has two new notes: savings sent to an account or fund that is not connected, and checking or savings accounts without a balance. A card counts as quiet after 21 days.
- The buffer on Kiinteät ja muuttuvat is the money on savings and checking accounts divided by what the household usually spends in a month, food included. It used to divide savings by fixed costs alone, which made a short buffer look sufficient. The text says what it counted, and under three months it says how much is missing.
- The usual spending and income of the buffer come from the last complete months. The month in progress is left out. A history of under three complete months gives no figure and says so.
- Without a balance the card says where to add one: Asetukset > Tilit.
- Saldot draws the total of the connected accounts, labelled as an estimate, with the last point at today. The table view has a column for each account. Balances are counted from the day the bank gave them, so rows imported after that day no longer shift the history.
- New report Havainnot: every finding that passed its threshold, largest yearly figure first, with its basis and a link to the rows. The overview shows the top three.
- Findings: price rises, loans and contracts that ended, new subscriptions and trials, yearly subscriptions renewing in 45 days, instalment plans, months that cost more two years running, purchases growing faster than income, and the share of income fixed costs take.
- A finding is shown only from 2 % of usual monthly spending or 10 € a month, whichever is more. A sync that lags, an account that stopped syncing or a switch to a new provider is not told as money freed.
- The largest purchase and the single-month category swing are no longer findings: the month explanation tells them.
- New report Tulot. It splits income by type: Palkka, Lomaraha, Muu palkka, each Kela benefit by name, ansiosidonnainen päiväraha, työeläke, veronpalautus, korot ja osingot, myynti and muut tulot. Money from people and refunds is shown as Henkilöiltä and Hyvitykset and left out of earned income. A Kela payment whose benefit the message does not name is Kela, muu, and a benefit with no known payer is Muut etuudet. A category set by hand decides the type.
- Each type opens to its payers (payments, usual amount, next pay day) and each payer to its rows.
- Mikä muuttui lists up to three changes by their monthly effect: a raise or cut per payer, pay that varies, a benefit that ended, started or changed, a new payer, pay that has not come, a new source, holiday pay, a tax refund or residual tax against last year. A net pay step in January is told as a tax card change, never a raise. Pay counts as missing two banking days after its pay day (a weekend or holiday moves it), and only when the account has later rows.
- The year view stacks the last twelve months by type, with the next twelve dimmed as an estimate from the regular income that still comes. Last year's holiday pay and tax refund are named beside it and left out of the estimate. Pay days, the spread of regular income in weeks of income, and income by member in the household view (a joint account stays whole) follow.
- Reports has a new section, Menojen muutos. It tells why spending differs from the usual level, from the same months a year earlier or from the same month a year ago. Each category change is split into a one-off payment, bill timing, new shops, shops that stopped, a dearer or cheaper ticket and more or fewer visits, and the parts add up to the cent. A category opens its shops, a shop its transactions.
- The rows of the month explanation name the largest cause of a move. A season mark says when the same month a year ago moved as far.

Look

- On a phone the tables of the Toistuvat page wrap the name column, so the date of the next charge is no longer cut off.
- The overview starts with one line that says what the numbers rest on: how many accounts, when they were last fetched and how many data quality notes there are. Below it come the month (the forecast range beside the explanation of the month, stacked on a phone), the next 30 days, where the income went with the fixed costs and a link to Toistuvat, the alerts and insights, the categories and the pace of the month, and the merchants.
- The four equal tiles with their arrows and sparklines, the calendar heatmap, the weekday sentence and Suurimmat ostot are gone.
- Alerts and insights have a Kuittaa button. An alert about a forgotten service is answered with Käytössä or Lopetettu, the same answers as on the Toistuvat page.
- On a phone the monthly table of the reports is a list with the months behind a tap, the price changes table stays inside its card, and the report links are one row.
- The favicon follows the colour of the logo.
- In a running month the "Mihin tulot menivät" bar shows the latest complete month and names it, instead of staying empty until the first month ends. A line under it sets that month's income and savings rate against the usual (the median of the six complete months before it, shown from three), and each Tavallisesti on the overview names the months it comes from.
- The Finnish text is shorter and uses one word for each thing, with no advice that lacks a number and no Git or Docker words in the browser.

Maintenance

- A rollback keeps the data written since the update when the previous version can read the database as it is, which it checks with its own `migrate-check`. It restores the copy from before the update only when it cannot.

For developers

- One definition per figure in core: analysis/usual.ts (usual level, complete month) and commitments.ts (fixed costs, subscriptions, expected bills), described in docs/MONEY_FLOWS.md.
- buildDashboard and buildReports take the account balances and the user's marks and expected bills (UserInputs) from services/analysis.ts requestInputs. They are read per request and stay out of the cached context.
- Repo rule 11: every report and every report section starts with a `// Decision:` comment that says what the household decides with it.
- `PUT /api/marks` with `{ subject, mark }` keeps one mark per user and subject (`merchant:<name>` or `alert:<id>`; `in_use`, `cancelled` or `dismissed`, or null to clear) and answers with the list. `GET /api/recurring` returns the marks too. A dismissed alert id is left out of the overview's alerts.
- `inUseQuietsQuestion` in `analysis/alerts.ts` is the twelve-month rule of "in use", shared by the alerts and the Toistuvat page.
- Repo rule 12 keeps the Finnish UI text to the style guide: no te-form verb, no exclamation mark, no "Ka/kk" or "%-yks.", no hyphen minus before a digit.
- `components/StatTile.tsx` is gone. The `.kpis` and `.tile-*` styles stay for the Toistuvat page.

Upgrade

- Migration 0010 adds the table user_marks (what each user said about subscriptions and alerts). It only adds a table, so rolling back to 0.6.0 keeps working and keeps the rows.
- Migration 0011 adds the table of expected bills. It only adds a table, so 0.6.0 still opens the database and a rollback keeps the bills typed in since the update.
- A rollback from 0.7.0 to 0.6.0 keeps marks and expected bills.

## 0.6.0

Money and reports

- A card bill is a transfer only for the card that is connected. A Platinum bill no longer disappears when only the Gold card is connected, and neither does another issuer's Gold bill. A bill that names only the issuer, such as Nordea Rahoitus or OP, still counts for the connected card.
- A person paid twice from a CSV account without account numbers is no longer looked up in the trade register as a shop. In such an account only card text, a merchant code, a card account, a company form or an e-invoice text mark a business.

Fetching and importing

- A bank connection that has expired gets its own notice, also while another connection works. Every connection that ends within 14 days gets a notice too.
- The same purchases in two Nordea CSV layouts are stored once. Rows already stored twice stay until you remove them.
- Rows in another currency than EUR from the bank are skipped like in a CSV import, and the fetch message says how many.

Look

- The new-device notice reads: if you did not sign in yourself, change the password and sign out all sessions.

Reliability

- From this release on, rolling back to an older version no longer loses the data written since the update when the update only added something to the database and the older version is new enough to run on it.
- A database copy (daily, before an update, before a restore) counts only after it has been flushed to disk, so a power cut right after a copy cannot leave an incomplete file under a good name.
- A new command, `node dist/node.js migrate-check <database file>`, tries the pending migrations on a copy of a database and reports the integrity checks, the row counts and the time it took, without touching the original.

Maintenance

- An update tries the new version's database changes on a copy of your data before the old version stops. If they fail, the old version keeps running with the data untouched, and *Asetukset > Ylläpito* says so.
- An update that fails or is interrupted before the new version starts keeps the old version as the current one, so a later restart starts the version that was running.
- The time a start may take follows how long the check on the copy took, so a long database change is not cut short.
- A rollback checks that its database copy is there and intact before it stops anything. Before, a missing copy left the app stopped.
- The update's state file and every database copy are flushed to disk before they count, so a power cut during an update cannot block a rollback.
- The rollback dialog warns when the update changed the database structure, or may have, because a rollback then loses what was written since.
- The maintenance helper answers at once when it is asked for an action it does not know, instead of blocking other actions for 30 minutes.

For developers

- `pnpm check` runs the CI test job without the build (typecheck, tests, shell lint, shell suites) and prints one line per step, with the failing test names and the first lines of each failure. The maintenance helper scenarios run four at a time, so the shell suites take about 20 seconds instead of 65.
- `pnpm test:core`, `pnpm test:server` and `pnpm test:sh:fast` run one part. `pnpm --filter @banking/core test` runs the core tests now. It used to run nothing and report success.
- `tools/ci/shell-lint.sh` holds the shell syntax and shellcheck step. CI calls it, and it fails when shellcheck is missing on CI.
- Repo rules in `tools/repo-rules` run with `pnpm test` and name the file and line to fix. They cover the purity of core, where SQL and security events are written, `user_id` on every `FinanceRepo` statement, em dashes in text, English in the UI text, the ops action list, the report registry and source file sizes.
- Folder import boundaries are checked as data. Imports that already break a boundary sit in a baseline that can only shrink: a new violation fails, and so does a baseline entry that no longer occurs.
- Shared server code (configuration, errors, ids, input validators) lives in `apps/server/src/platform/`.
- Helpers that existed in two places now exist in one.
- `UpstreamError` is the base class for failures of outside services: `app.ts` answers 502 for it without naming Enable Banking.
- Where transactions come from is now a connector (`apps/server/src/connectors/`) with one sync loop, and file formats are import parsers in `packages/core/src/sources/`. A new bank or format is a folder and a registry line.
- CI runs the shell checks, the JS checks, e2e and docker side by side and ends in one `ci-ok` check. The upgrade rehearsal also runs on `release/**` branches and ends in `upgrade-ok`. `pnpm typecheck` covers `e2e`, `tools` and the root config too.
- `node tools/release/prepare.mjs X.Y.Z` bumps the version and builds the CHANGELOG section from `changelog.d/`. `docs/RELEASING.md` has the new steps. The GitHub Actions checkout and setup-node pins moved to 7.0.1 and 7.1.0.
- `FinanceRepo` is split into modules in `apps/server/src/db/finance/` behind the same class, and the `user_id` repo rule checks each module.
- The web styles are split into `styles/tokens.css`, `base.css` and one file per page area, and each report section is a file in `pages/reports/sections/`.
- A module can ship switched off: add it to `FEATURES` in `packages/core/src/features.ts`, mount its routes with `gated(s, id, routes)` and give its nav entry in `nav.ts` a `feature`. Unfinished (`dev`) flags are not shown in Asetukset > Palvelin.

Upgrade

- Migration 0009 adds one column on the first start, after the usual copy. A rollback to 0.5.1 puts that copy back.
- The check on a copy protects the updates after this one: the update to 0.6.0 still runs the update script of the version you have. Later checks need free space on the data volume of about twice the database.

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
