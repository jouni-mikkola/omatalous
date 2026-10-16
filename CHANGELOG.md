# Changes

Update with `./scripts/update.sh`, go back with `./scripts/update.sh --rollback`. Database changes run on
start, after a copy is taken.

## 0.61.0

- Laskut tells contracts by their start and end: a lease, loan, insurance or phone contract shows since when it runs, ended contracts move under Päättyneet sopimukset with their dates and cost, and the refund at the end of a contract lowers its cost instead of counting as income.
- An ended contract is no longer counted in coming payments, and a credit note while a contract runs stays income.
- Smaller fixes: the update dialog names the version, a co-holder's name is in normal case, Tekniset asetukset shows a loading state instead of empty boxes, and a trade register answer beats a guess from a trade word.
- Comparisons with last year only use months and accounts that have data on both sides, and say how many months were compared; a newly connected or closed account no longer makes a change of +100 %.
- An account the bank calls a loan but which only passes the instalments on is shown as Lainanhoitotili and is no debt; a paid-off loan says Maksettu; a loan the app cannot place is asked once, and a home loan answer is used in Asuminen.
- Tietojen laatu opens with the share of the last 12 months' spending filed without asking.

Money and reports

- Laskut tells a lease, a loan or a phone, insurance or gym contract as a contract: each row of Sopimukset ja laskut shows when it began and opens its first payment, monthly cost, last payment and total paid.
- A contract that has stopped is listed in Päättyneet sopimukset for two years, with the days it ran and what it cost, and is never counted as a coming payment.
- The refund a company pays within 60 days after a contract's last payment (a lease deposit) is no longer income: it lowers the spending of the contract's category and is shown with the contract.
- Asetukset > Tietojen laatu opens with how much of the last 12 months' spending the app filed without asking: "Viimeisen 12 kuukauden menoista 87 % on luokiteltu ilman kysymistä." A second line tells how much of that was a guess (a register code or a trade word) and how much you filed yourself, when either is above zero.
- A comparison with last year or with the period before now sums only the accounts that have data for the whole of both periods. An account that began or closed in between is left out of both sides, so it no longer shows as +100 % or as a fall in a category. When the accounts left out carry over a tenth of the spending, no change is told.
- The year comparison says how many months it rests on, that accounts were left out, or why there is no comparison yet, and its labels name the months the figures hold.
- "Kalliit kuukaudet" and the finding beside it read the same history, so one no longer says it is too short while the other uses two years.
- A payee the trade register has found now takes the register's category also when a trade word of the lexicon had guessed another; a brand the lexicon lists by name still wins over the register.

Look

- A co-holder of an account who has no login is named in normal case ("Korhonen Elisa", not "KORHONEN ELISA") in Raportit > Yhteiset menot and in the shares of an account, the way a payee is.
- The update dialog in Asetukset starts with "Päivitetään versioon X." when the version to install is known.
- Tekniset asetukset shows the loading placeholder until its data has arrived, instead of empty cards.

## 0.60.0

- Payments the app used to leave in Muut menot are now filed by what the payee does: car leasing gets its own category Autoleasing, and energy, district heat, water, waste, housing companies, insurers, unions, shops and trades are known by name, with the trade register as the next step.
- Card bills from the same issuer under different names are one issuer now, and Tietojen laatu lists the card bills whose purchases the app cannot see, with the reason; Laskut lists a connected card's coming bill.
- Your own rules and choices always come first, and a rule you set on an issuer's old name keeps applying after the names are merged.

Money and reports

- A card issuer is one payee under every spelling (Morrow, Morrow Bank ASA, SEB Kort Bank AB), and Tietojen laatu lists the card bills without purchases by issuer, with the reason. Yhteenveto names the largest.
- Laskut lists a connected card's bill in the group of its due date, as Yhteenveto does.
- The trade register lookup finds the company a short or shortened name means, and files a company with a broad industry by the trade word in its name; a steady car rental and leasing payment is Autoleasing, bus stations and musical instrument shops no longer file as car and home.
- Car leasing payments file under the new category Autoleasing and count as a contract; waste, district heat and water payees get their kind on Asuminen.
- A name with a company form, a business id or a known trade is a company, never a person.
- Payments to well-known Finnish brands, shops, unions and trades that used to land in Muut menot now get the right category without asking, for every household.

Upgrade

- The first start copies rules, marks and Optimoi decisions made on the old spellings of a card issuer's name to its new name; the old ones stay. If the old spellings chose differently, the new name gets none.

## 0.59.0

- Yhteenveto's waterfall and the table under it now show the same income and spending to the cent; savings and credit get their own sentence.
- Raportit and Säästövinkit say when much of the spending is not itemised, and a check with nothing to check says "Ei tarkistettavaa" instead of "Ei huomautettavaa".
- Your part of a row paid into a joint account is the same number on the row and in its panel; smaller page fixes from a live review (version number in the update card, housing costs named by category, empty joint accounts left out).

Money and reports

- Raportit and Säästövinkit say how much of the spending is not itemised when it is over 20 %, and Tarkistettu says "Ei tarkistettavaa" for a check with nothing to check.
- Säästövinkit no longer says "Ei vinkkejä." beside Muut havainnot, and Kalliit kuukaudet and the expensive-month finding use one history test.
- The part a row of a joint account shows on Tapahtumat and the total of the "Miksi?" panel it opens are now the same figure, also for an account cut by who paid.
- The waterfall of Tulot ja menot on Yhteenveto shows the same Tulot and Menot as the table beside it, and its sentence names what went to savings and credit.

Look

- Tekniset asetukset shows "Ladataan…" while it loads, the update card names the new version, Yhteiset menot leaves out a joint account with nothing paid in the month and names a co-holder with no login, Asumiskulut shows the category when the kind is unknown, and the debt rows of Varallisuus fit a phone.

## 0.58.0

- Yhteenveto shows the month as a waterfall: income, each spending category, and what is left. A tick beside each account balance tells whether the bank's balance matches the rows.
- The "Miksi?" button is gone: a figure the app works out is itself the button that opens its rows. Balances and forecasts no longer open anything.
- Laskut loads only what is due, and several settings sentences read plainer. Tools updated (Playwright 1.64, Vitest 5).

Look

- Yhteenveto shows the month as a waterfall: income up, each spending category down, and what is left last, with the joint pools' sentence under it. A tick beside each account balance tells whether the bank's balances match the rows. The balances no longer have a Miksi? button, and the page fits phones from 320 px with controls of 44 px.
- The "Miksi?" button is gone: a figure the app works out (income, spending, a category, Yli jäi, a usual income, your part of a joint row) is itself the button that shows its rows, marked with a dotted underline. Balances and the forecast no longer open anything. Laskut asks only for what is due instead of the whole first page, a pay with no estimate shows a dash, the waterfall calls its transfer bar "Säästöt ja luotot", and several sentences in the remote access, loan and bank settings read plainer.

## 0.57.0

- "Miksi?" now also opens each account balance and "Tilit yhteensä" on Yhteenveto, "Käytettävissä" in Erääntyvät maksut, your share of a joint row on Tapahtumat, "Tavalliset tulot kuukaudessa" and the "Yli jäi" row in Raportit. Each panel shows exactly the number beside it: the rows behind a sum, the months behind a median, or what a forecast reads and assumes.
- Plainer Finnish in the Miksi? panels, in Yhteiset menot and in the Jako form.

Money and reports

- A "Miksi?" button now stands beside the figures that Yhteenveto and Raportit tell: it opens the rows behind the figure and says whether they add up. It covers sums and balances, the usual income (month by month), the part of a joint account's row, "Yli jäi" and what is left to use before payday. An estimate says in plain words what it read and what it leaves out.
- Plainer Finnish on Yhteiset menot and in the Jako form.

## 0.56.0

- Settlement between partners. Under Asetukset > Tilit each joint account and shared card has "Jako": equal, by shares, in proportion to income or a fixed sum with the rest split another way, valid from a day you choose, earlier agreements kept below. A split in proportion to income waits until every named partner has accepted it ("Hyväksy"); a partner can turn it down ("Hylkää") and the one who proposed it can take it back ("Peruuta ehdotus").
- Raportit has "Yhteiset menot" per month and joint account: what each partner paid, their share and who paid over or under it. Money of unknown origin is shown apart under "Ei tiedossa", never put on anyone. A closed month is locked; a later change shows as "Korjaus kuukaudelta …" in the running month, so nothing already settled moves.
- Admin has "Jäsenet ilman tunnusta" for a partner who pays into the joint account but has no login of their own.

Money and reports

- Raportit has Yhteiset menot: for each month and joint account, what each member paid, their share and who paid over or under it, with the month locked on its closing day and later corrections named.
- Asetukset > Tilit has Jako on a joint account or card: the split in force, earlier ones, and a form to change it from a day.
- Asetukset has Jäsenet ilman tunnusta for the administrator: household members with no login, optionally named as the bank shows them.
- A split that follows income waits until every user it names has accepted it; each of them can accept (Hyväksy) or decline (Hylkää) it, and the one who proposed it can take it back (Peruuta ehdotus). Until then the earlier split holds.
- Yhteiset menot lists money nobody of the account paid or owes under its own heading, Ei tiedossa.

Upgrade

- Migration 0022 adds one table for the frozen months of a joint account's split. Version 0.55.0 can still open the database after it, so a rollback keeps what was recorded.

## 0.55.0

- "Miksi?" beside the month's income and spending on Yhteenveto and beside each category and the total on Raportit opens the rows behind the figure: day, payee, category, the reason the row was placed where it is (your own choice, your rule, a transfer between own accounts, your part of a joint account, a refund netted against its purchase), and at the foot "Täsmää" or the difference in euros, never hidden. Rows the figure leaves out are listed apart.

Look

- Yhteenveto and Raportit: "Miksi?" beside the month's income and spending, and beside each category and the total of Kategoriat, opens the rows the figure adds up, with the bank's whole sum where a row is cut to your part, and ends in "Täsmää" or the difference.

## 0.54.0

- Two-step sign-in: Asetukset > Kaksivaiheinen kirjautuminen turns on a code from an authenticator app (password and one code to confirm), gives ten recovery codes shown once, and asks for the code after the password at every sign-in. An admin can remove a member's second step, and the server command `user remove-factor` brings a locked-out admin back. Works on plain http too.
- Payer answers can be seen and changed later: Säännöt has a "Maksajat" list with each answer, how many payments it moved, a choice to change it and "Palauta ehdotus".

Money and reports

- Answers to "Mitä nämä ovat?" are listed under Säännöt in Maksajat: change an answer there, or take it back with Palauta ehdotus.
- A data file with a payer answer the app does not know is refused instead of imported.
- Changing a merchant's category no longer sends the whole history through processing again when you have payer answers.

Look

- Asetukset has a card for two-step sign-in: turn it on with an authenticator app, keep ten recovery codes, and the sign-in asks for the code after the password.

## 0.53.0

- "Täsmää pankin saldoon" on each euro account in Asetukset > Tilit: a tick when the stored rows add up to the bank's own booked balances, or the reason when they cannot be checked (vain käytettävissä oleva saldo, ei viitepäivää, tyyppi vaihtui, liian vähän saldoja). Opened, it lists the days that agree and where the check stopped.
- Only booked balances prove anything, never an available balance, and never two balance types mixed. The example household now has daily balances so the check can be seen.

Look

- Asetukset > Tilit: each bank account says under its name whether the bank's balances match its transactions, and opened shows the days that match.

## 0.52.0

- Money from a steady payer gets its meaning from one answer: Yhteenveto asks "Mitä nämä ovat?" (yhteisten menojen osuus, myynti, omaa rahaa, lahja, palkka tai etuus) with the proposed answer marked, and the answer moves that payer's past and future payments in your own view. Payments clearly off the usual sum stay as they were, and "Palauta ehdotus" takes the answer back.
- Earned income has one definition across the app: money from people, refunds and your own money moved between accounts are never counted as earned. At most three questions are asked a visit.

Money and reports

- Yhteenveto asks what money from a steady payer is (a share of shared costs, a sale, your own money, a gift, or pay) and your answer moves the past months too.

## 0.51.0

- The bank link is set up and kept from Asetukset alone: the steps at Enable Banking each have a link and a mark when done, "Testaa paluuosoite" tells before you meet the bank whether the return address is accepted, and a consent the bank ended shows "Yhdistä uudelleen" on its row.
- Per bank, Asetukset shows what the bank has given so far: consent length, card accounts, pending rows, balance types and how far back history reaches.
- The bank's limit of four fetches a day without you is now counted per account, so one full account no longer stops the others, and a fetch you start yourself sends the headers each bank asks for.

Fetching and importing

- The bank link is set up and kept from Asetukset without files or a terminal: the outside steps with links, a test of the return address, what each bank supports, and the reason on a consent that ended.

## 0.50.0

- A card bill's purchases can be filled in by hand: "Erittele ostot" on the bill row in Tapahtumat takes rows typed one by one or pasted from the card statement, shows what it read before saving, leaves out payment rows and shows what is still unexplained. The statement itself never leaves the browser.
- Spending then follows the day of each purchase, and a month's spending total and its categories come from the same rows, so they always agree.

Look

- A card bill row in Tapahtumat opens "Erittele ostot": paste lines copied from the card statement or add rows by hand, and the bill row tells how much of it is itemised.

## 0.49.0

- Asetukset > Tiedot has "Tuo tiedot": the file of "Vie kaikki tiedot" comes back in. A check shows first what would be added and what is already there, and nothing that exists is changed or removed. Only the user who made the file can bring it in.
- A renewed bank consent fetches the longest history the bank gives, not only the first link, and the app keeps from which day each account's rows are known.

Fetching and importing

- A renewed bank consent fetches the longest history the bank gives, once, and the app keeps from which day each account's rows are known.

Look

- "Tuo tiedot" in Asetukset > Tiedot brings the file of "Vie kaikki tiedot" back in, with a check first, and nothing existing changes.

## 0.48.0

- Asetukset > Tiedot has "Vie kaikki tiedot": one file with your own data and what is shared with you, without passwords, tokens or the bank's raw data. A member and an administrator each get what they see in the app.
- The transactions CSV has a Lähde column: pankki, tiedosto or esimerkki.
- Under the hood: time limits for the whole-history recalculation and for opening the front page now fail the tests when they slow down.

Maintenance

- Asetukset > Tiedot has "Vie kaikki tiedot": one JSON file with your own data and what is shared with you (accounts, transactions, rules, answers, loans, bills and the rest), with no password, token, bank session or raw bank payload; a member and an administrator get what they see in the app. The format is in `docs/DATA_EXPORT.md`.
- The transactions CSV has a Lähde column (pankki, tiedosto or esimerkki).

## 0.47.0

- Rows the bank books in another currency are no longer dropped: they are kept in the bank's own figure and listed under their account on Asetukset > Tilit, marked "ei mukana euromäärissä".
- No euro figure counts them. On Saldot, a day an account's balance cannot be known because of such a row shows a dash, also in the month's total, instead of a total that leaves the account out.

Fetching and importing

- Rows the bank books in another currency than the euro are kept in the bank's own figure and listed under the account in Settings > Accounts; no euro figure counts them, and the balance history starts after the newest of them.

## 0.46.0

- Balance history is kept from this version: every fetch stores the balances the bank sends, and nothing of it is removed at start-up.
- A card bill paid from a joint account to one member's card counts as that member's own spending in who paid, not as a cost of everyone.
- While an update runs, the page shows each step as it starts and how long it took; a new version is on offer within the hour without pressing Tarkista päivitykset.

Money and reports

- A card bill paid from a joint account to the card of one member now counts as that member's own spending in the split of who paid, not as a cost of everyone.

Fetching and importing

- Balance history is kept from this version: every fetch stores the balances the bank sends, for the history views to come.

Maintenance

- While an update or another maintenance action runs, the page shows each step as it starts, and each step's own time.
- A new version is looked for once an hour, so Päivitä is on offer without pressing Tarkista päivitykset. A version that was taken back is not offered again for a day.

Upgrade

- Migration 0021 adds the tables the next releases fill and two empty columns on expected bills. Version 0.45.0 can still open the database after it, so a rollback keeps what was recorded.

## 0.45.0

- A balance in another currency is no longer added to the euro total as euros: an account in dollars shows its balance with its currency on Tilit and stays out of every euro total.
- Saldot starts from the day the bank's balance refers to, not from the day it was fetched, so the rows between those days are no longer missing from the figure.
- Linking a bank account to a file account with the same number works again when a row has a split: the split, a category you set and the transfer mark move to the bank's row, and a row the bank already had is no longer kept twice.
- A card bill row on Tapahtumat says that its purchases are not shown.
- The front page and Asetukset > Lainat list the same loan proposals.

Money and reports

- An account in another currency than the euro shows its balance with its currency and is no longer added into Tilit yhteensä as euros.
- Saldot and Tilit walk the balance from the day the bank says it stands for, not from the day it was fetched, so the rows of the days between no longer move the figure.

Fetching and importing

- Linking a bank no longer fails when a file account of the same IBAN has rows with a stored split of who paid: the split moves with the rows.
- A file account folded into a bank account no longer leaves a second copy of a row the bank account already has: the file copy is dropped.
- A folded file copy's split and hand-set category (with its transfer flag) move to the bank row that has none of its own.

Look

- A card bill row on Tapahtumat says "Korttilasku: ostot eivät näy".
- The front page names only the loan proposals that Asetukset > Lainat lists, also in Koko talous.

## 0.44.0

- A bill paid another way counts as paid everywhere: the year of rare bills keeps its figure when the payment arrives, and a bill whose payment is still pending shows "varaus" after the payee, with the same sum on Yhteenveto and Laskut.
- A loan proposal asks only for what is still empty: when the loan account's balance is known, only the rate is asked.
- After a bank link the page keeps looking for the new accounts even when the first fetch has not listed any yet, so the question about who uses an account appears without a reload.
- The roadmap is public: docs/ROADMAP.md says where the app is going, release by release, and what 1.0 means as checks that pass.

Money and reports

- A bill paid another way, from another account or under another payee name, counts as paid in the year of rare bills, and stays in what is due before payday only until the bank has booked the payment, marked "varaus".

Look

- The help under "Tallenna lainaksi" asks only for what is still empty: the rate when the balance is filled in, else the balance and the rate.
- After a bank is linked, Asetukset looks again for the new accounts also when the bank has listed none yet.

## 0.43.0

- The front page asks what mends the picture most: a new block right under the accounts tells how much of the last twelve months' income and spending is classified and lists the five largest payees nobody has classified, each with a category to choose on the spot. A loan the app found from the payments is asked there too.
- A connected loan account shows as a loan. Banks tell a loan's balance as a positive amount and the app read only a negative balance as debt, so a connected loan stood in no loan list. Old data is mended at the update.
- A bill paid another way is no longer falling due: paid from another account of the household, or by hand under another name with the bill's reference or the payee's account number, it counts as paid and the next one is expected a step later.
- Maintenance starts within seconds: after a press in Asetukset > Ylläpito the helper on the host begins in a few seconds instead of at the next full minute.

Money and reports

- A bill paid from another account of the household, or by hand under another name with the bill's reference or the payee's account number, no longer stands as falling due.
- The next one is expected a step later.
- A connected loan account now shows as a loan with the balance the bank tells, also where the bank tells it with a plus. Balances stored before are mended when the update starts.
- A loan found from the payments opens in Asetukset > Lainat with the loan account and its balance already filled in, when exactly one loan account has no saved loan.

Look

- The front page has a new block, Luokittelemattomat, right after Varallisuus. It says how much of the last twelve months' money is classified.
- The block asks the few things that would mend it most: a category for a payee, or Ohita; a monthly payment that may be a loan, saved or marked Ei laina.

Maintenance

- A press on the maintenance page starts within seconds, no longer at the helper's next minute.
- "Tarkista päivitykset" and then "Päivitä" no longer wait a minute each.

## 0.42.0

- The app fetches new transactions when you open it, and the top of every page tells when they were last fetched. Until now rows came only at the sync hours (6 and 18 by default), so a bill paid in the evening could stand as unpaid until the next morning. The bank allows only a few fetches a day without the user present, and the app stays inside that.
- One payee is one payee: payment services such as Trustly and Zimpler are seen through to the company that was paid, and a company is the same payee whatever its spelling or company form. Old transactions are moved at the update.

Money and reports

- Payment services such as Trustly and Zimpler are seen through to the real payee, and a payment that names only the service has one payee for it.
- One company is one payee whatever the spelling or company form, and old transactions are moved at the update.

Fetching and importing

- The app fetches new transactions when you open it, within what the bank allows, and no longer only at the sync hours.
- The top of every page tells when the transactions were last fetched from the bank, and new ones appear without a reload.

## 0.41.0

- The maintenance page tells what a request is doing: how long it has waited and run, when the helper next looks for work, the steps of an update with their numbers, and how long the whole thing took. After an update restarts the app the page notices it within seconds, not up to a minute later.
- The README is rewritten: a short opening, what the app does, pictures of the main pages, the banks, your data and a diagram of how it is built. The pictures are made from today's app by one command, `pnpm docs:shots`, so they no longer go stale.

Look

- The maintenance page shows how long a request has waited and run and how long it took, numbers the steps and says when the helper next looks for work.
- While an update restarts the app, the page notices the new version within seconds.

For developers

- `pnpm docs:shots` remakes the pictures of the README and the docs (Yhteenveto, Tilit, Raportit, Tapahtumat, a phone) from the example household.

## 0.40.0

- Under a joint account in Asetukset > Tilit, "Maksut ja menot kuukausittain" shows month by month what each of you paid in, which costs each of you bore, what was moved away and whose money is left. Each figure opens that month's rows of the account in Tapahtumat.
- Money that comes back from a payee the joint account paid only for one person, such as a card company returning part of that person's card bill, is taken off that person's transfers and not off the shared costs.

Money and reports

- Under a joint account in Asetukset > Tilit, "Maksut ja menot kuukausittain" shows for each month what each of you paid in, bore of the costs and moved away, what each took of the other's money, and what is left of whose. Each figure opens the account's rows of that month in Tapahtumat; the newest three months are open. A holder of the account who has no login of their own has a column too, and a refund of money moved to a member's own account comes off what it was counted in, not off the costs.

## 0.39.0

- A joint account can now be cut by who paid into it: a bill paid from it is the cost of the one whose money was in the account, money the other takes out is a transfer, and each member's spending, balance and lists follow that. Asetukset > Tilit offers the three ways to cut a joint account: by who paid, equally, or by percents.
- When the app cannot name who paid money into a joint account, it asks once under "Kenen rahaa?", and an answer can be taken back under "Vastaukset". Ilmoitukset tells when a split was set, when the payments no longer match it and when payers are unnamed.
- Asetukset ends with a Tietoja block: the version, who made the app, the source code and the licence.

Money and reports

- A joint account that one of you pays into is cut by who paid: a bill is the payer's own cost, money the other takes out is a transfer, and the spending, balances and lists of each of you follow it. The app sets this once for an account nobody has said a use of, when its rows show it clearly.
- Money in from someone the account cannot name is asked about once, and an answer moves no other cent.
- A use typed in euros a month keeps those euros, and a joint account nobody pays into alone is cut as before. The proposal of euros a month from the account's rows is gone.
- Under a joint account, Asetukset > Tilit offers three ways to cut it: by who paid into it, equally, or by percents. "Prosentit" has a field for each user, the last one filled with the rest of 100.
- When the payments to a joint account show a split other than the one set, Tilit offers it in one row, and Ilmoitukset tells it.
- "Kenen rahaa?" lists the payers and the opening balance nobody has named, largest first, with the answers as buttons; "Vastaukset" lists the answers and takes them back.
- Ilmoitukset tells when the app set a joint account's split, when the payments no longer match it and when payers are unnamed, each with a link to Tilit that you can close.
- On Yhteenveto a joint account cut by who paid says "Yhteinen tili" with no percent, and a row of Tapahtumat with an unnamed payer links to its account with "Kenen?".

Look

- Asetukset has a Tietoja block with the version, who made the app, the source code and the licence.
- Under it one line says the app is free, with a link for those who want to support its development.

Upgrade

- A joint account's figures change when it is cut by who paid. Migration 0020 adds four tables; the build before refuses the new database, so keep the copy the upgrade makes.

## 0.38.0

- The first page no longer shows a coming pay as one sure sum: a pay that hardly varies reads "noin", a pay that varies (commission, shifts) reads as a range with the smallest, largest and most usual of the last pays, and only the low end is counted when the page says whether money runs short.

Money and reports

- Erääntyvät maksut tells a coming pay as an estimate: "noin 2 480 €" for a pay that hardly varies, and a range with a sentence of the last pays for one that does (commission, shifts). A pay with fewer than three pays behind it shows its day and no sum, and only the least a pay is expected to be counts towards the day the balance runs short.

## 0.37.0

- Raportit has a new part, Ruoka: groceries, restaurants and cafés, food delivery and Alko each on a line of its own, with the sum a month, the average purchase, the times a month, the largest payees and the weekdays.
- Raportit: Menot kuukausittain replaces the wide category table. It is by theme, shows the last twelve months, the usual level and the difference, and a row opens to its lines and payees. The old table is behind Taulukko.
- Säästövinkit shows every finding and lists what it checked (Tarkistettu); findings with low certainty are no longer left out.

Money and reports

- Säästövinkit shows every finding of an area (three open, the rest from "Näytä lisää"), and a finding with several weak points is shown at certainty "matala" with its reason instead of being left out.
- Säästövinkit ends with Tarkistettu: a row for every check that found nothing, with one word for why (nothing to note, information missing, too few months, no rows).
- Uncategorised spending and an own account that moves money to an unconnected one are said once above the findings and no longer lower each finding. Findings that this lifted from matala to keskitaso, and findings that used to stand fourth or later in an area, now count in "Säästömahdollisuus vuodessa (arvio)" and in the follow-up's sum of what was found, so those sums can rise with no new finding. In the demo and the test households none moves.
- Reports has a new part, Ruoka: groceries, restaurants and cafés, food delivery and Alko, each with its sum a month, its share, a week, the average shop and visits a month. A line opens to its months, its five biggest payees, the weekdays of the purchases and, for groceries, the basket now and before. Card bills are a row of their own, so the lines never read as all the food money.
- On the front page the food sum in the table of themes links to it.

Look

- Reports: the month table is now "Menot kuukausittain". It shows the spending by theme, each row opening to its lines and a line to its five largest payees, with the newest complete month beside its usual level and the difference. A strip of the last twelve complete months marks the highest one and names the three rows it went to. The table of every category by month is still there behind "Taulukko".

## 0.36.0

- Päivitä sovellus: the dialog no longer shows scrollbars when everything in it fits.
- Tekniset asetukset: Varmuuskopiot shows the five newest copies; the rest open with Näytä lisää.
- The scheduled backup of the host keeps its copies for 7 days by default (it was 30); set KEEP_DAYS to keep more.

Look

- The window that opens from Päivitä sovellus no longer shows scrollbars when its content fits.
- Varmuuskopiot shows the five newest copies and opens the rest from Näytä lisää, with the number of all copies beside it.

Maintenance

- The daily backup in `backups/` is kept for 7 days instead of 30; to keep a month, put `KEEP_DAYS=30` in `.env`. The older backups of an install are deleted at its next scheduled run.

## 0.35.0

- Raportit: Kaavio and Taulukko are one switch with both choices in view, the same in every part that has a table.
- Raportit on a phone: the months under an opened row of Kuukausitaulukko stand in one block.

Look

- Reports, income and spending: the chart and table choice is one switch with both choices in view.
- Reports, monthly table on a phone: the months under an opened row stand in one block.

## 0.34.0

- Nothing changes in the app or for an install. For developers: the release workflow can now also build and smoke test a release's images ahead of time, on a branch `candidate/X.Y.Z-...`; such a run signs, tags and releases nothing.

For developers

- The release workflow also runs on a branch `candidate/X.Y.Z-...`: it builds both images, smoke tests them and records their digests, and signs, tags and releases nothing. A push to `main` still builds, signs and releases in one run.

## 0.33.0

- Tapahtumat: a category you open to change is as wide as the name it shows, so the row stays where it was.
- Säästövinkit on a phone: a finding's four buttons stand two and two instead of three and one.

Look

- On Tapahtumat, a category you open to change is as wide as the name it shows, so the row stays where it was.
- On Säästövinkit on a phone, a finding's four buttons stand two and two instead of three and one.

## 0.32.0

- Laskut: in the form of Lisää lasku every field shows its whole value: the choice of Toistuu and the date are no longer cut on a wide screen.
- Asetukset: the password form has the measures of the other settings forms, and in Uusi laina the choice of the linked account is no longer as wide as the page.
- Raportit on a phone: in the table of Tulot ja menot the month stays in sight while the figures move sideways, and an opened row of Kuukausitaulukko has the same mark as the other folds.
- Tapahtumat of one merchant: the controls stand on one row, a long name wraps inside its chip, and the summary's cells fill their rows.
- Säästövinkit and Kauppiaat: the calculation of a finding and the field of a rule have a measure instead of the width of the page.

Look

- The form for adding a bill shows every field whole: two fields a row, and a rule closes it above the table.
- The password form in Settings has the size of the other settings forms.
- The account choice in the new loan form is no longer as wide as the page.
- On a phone the table of Tulot ja menot keeps the month in view while the figures move, prints the month short on one line, and shows more columns at once.
- The months list of Kuukausitaulukko opens with the same chevron as the other folds, and the open row has a bold name.
- On a merchant's page the filter controls and the merchant's chip stand on one row, and the summary cells stand four to a row.
- In a saving tip's calculation the labels stand next to their figures and the column heads stand over their cells.
- In Kauppiaat the text field of a rule has a sensible width, and on a phone the rule's fields share one width.

## 0.31.0

- Säästövinkit: in Tiedot, joita tarvitaan a label, its field and the key stand together, instead of the label at the left edge and the field at the right.
- Asetukset: in Tilit an account without a number no longer gets a line with a lone dash, and the line about an account's use keeps a readable measure; on a wide screen the columns of Talouden jäsenet stand close together.
- While a page loads, its frames are drawn first, with an edge that can be seen, and the word Ladataan… comes below them.
- The first-run wizard shows a failed step as the same error card as the rest of the app.

Look

- The data a check asks for now keeps its name, its field and its save button together.
- An account with no number no longer shows a lone dash, and the sentence about a joint account's shares is no longer a very long line.
- On a wide screen the household members' table keeps its columns close enough to read a row as one.
- The loading frames of a page have an edge you can see, and the first screen shows the frames instead of a lone "Ladataan…".
- The first-run wizard shows a failed step in the same red card as every page.

## 0.30.0

- A wide screen is used: from 1600 px Tulot stands beside Kategoriat on Raportit and the two panels of findings stand side by side on Säästövinkit, on columns of exactly 100 px, instead of every row growing longer.
- Raportit: the charts no longer stretch on a wide screen, the five figures of Kiinteät ja muuttuvat stand on one line, and on a mid-width screen Kuukausitaulukko lists its rows in two columns.
- Tapahtumat: in Luokittelematta a name and its sum stand close together, and the date range stays on one row with the other controls.
- The top bar is one row from 990 px, and the switch between Oma and Koko talous never breaks into two lines.

Look

- On a screen 1600 px wide or more, Raportit puts Tulot beside Kategoriat, Asetukset puts Salasana beside Tekniset asetukset, and Säästövinkit puts the panels of findings side by side; narrower screens are unchanged.
- On a screen 1600 px wide or more the page columns are a whole 100 px, so the register's marks fall on whole pixels.
- Laskut shows its two figures on top side by side from 641 px instead of 1040 px.
- In Raportit the five key figures of fixed and variable costs stand on one line, even when a label takes two lines.
- On a wide screen the columns of the monthly charts stay slim instead of floating apart, and the balance chart grows taller with its width.
- The balance chart's January label shows the year under the month, as the column charts do.
- Between a phone and a wide screen the monthly table list of Raportit runs in two columns with the total across both.
- On Transactions, an uncategorised item's name and its sum now stand close together on a wide screen instead of far apart.
- On Transactions, the From and To dates stay on the same row as the other filters on a tablet-width window.
- The top bar is one row from 990 px wide, with the pages beside the view switch.

For developers

- `pnpm shots --only "<selector or panel heading>"` takes one part of a page at full size. A whole-page picture is taken from the top of the page and keeps the phone tab bar off the last lines.

## 0.29.0

- Raportit: the balance chart labels every month that has room, the total of Kuukausitaulukko carries the same double rule as the total of Kategoriat, and Tulojen käyttö stands on one row on a mid-width screen.
- Säästövinkit: the five figures of Tilanne stand on one row, and a finding's text uses the width beside its figure.
- Tekniset asetukset: Tietojen laatu is a plain list on the panel's edge, Haku pankista shows no empty column, and the fields have measures instead of running the width of the page.
- Tapahtumat and Laskut: the category shows its longest name whole on a mid-width screen, and a payee's name no longer leaves its last word alone on a line.

Look

- Säästövinkit: the facts at the top stay in one row on a tablet, a finding's text uses the width beside its figure, and the word after a figure is no smaller than a label.
- Tapahtumat: the category shows its longest name whole on a tablet, and on a phone it has no faint frame.
- Laskut: a name in Sopimukset ja laskut is no longer broken to leave its last word alone on a tablet.
- The balance chart in Reports prints a month's label whenever it has room, and two labels never touch.
- The total of the monthly table has the same double rule as the category total, in the table and in the list.
- In the monthly table's list, the average line starts under the name, not under the arrow.
- On a tablet the income-use figures stay on one row instead of leaving one alone.
- Technical settings: the data quality list stands on the panel's left edge without bullets.
- Technical settings: the fetch table leaves out the message column while no run has a message, and the number of new transactions stands at the right edge.
- Technical settings: the server address, time zone, history and Application ID fields are no wider than their content needs.
- Technical settings: the bank setup lines you copy are in the normal text size, and on a phone a copied address breaks only where the line is full, "Kirjaa ulos" stays on one line and a run's date stays together.

## 0.28.0

- Shares printed side by side (Kiinteät ja muuttuvat, Kategoriat, Tulolajit, Tulojen käyttö) now add up to 100 % as printed, and the sum bracket stands on a column of whole euros only when the printed rows add up to the printed total.
- The pages were measured on a mid-width screen, between a phone and a desktop, and ten faults were fixed: the figures of Raportit no longer overlap, Kuukausitaulukko turns into its list instead of a cut table, Kauppiaat shows the columns that fit with every sum whole, and a notice on Yhteenveto wraps instead of losing its unit.
- Asetukset and Tekniset asetukset: account numbers stay on one line, the maintenance warning stands once, and Versio has no lone dash.

Money and reports

- Shares of one whole that stand side by side (Kiinteät ja muuttuvat, Kategoriat, Tulolajit, Tulojen käyttö) now add up to 100 % as printed, not 101 % or 99 %.
- The bracket beside a column of whole euros (Kategoriat, Kuukausitaulukko) is drawn only when the euros printed add up to the total printed.

Look

- Reports: on a mid-width screen the figures of fixed and variable costs each keep their own cell.
- Reports: the monthly table turns into the list whenever its twelve months and total would not fit, and the list shows each category's name beside its total again.
- Reports: the year of January stands under the month on the month charts, so the labels never run together.
- Merchants on a middle-width screen show the columns that fit, with every sum ending in its euro sign.
- A notice on the overview wraps its detail instead of cutting off its unit.
- The housing charges' share bar is drawn for every row, not only the first and the last.
- Settings: on a narrow screen the bank connections no longer split an account or card number over two lines.
- Technical settings: the maintenance helper warning with its command shows once, under Maintenance, not again under remote access.
- Technical settings: Version has no lone dash before the first check for updates.

## 0.27.0

- Laskut, Kauppiaat, Raportit, Säästövinkit and Asetukset were measured from pictures against the design, and twelve faults were fixed: no empty panels or empty halves, no text cut by its own frame, folds that open with the same arrow everywhere.
- Kauppiaat ranks only money out: a payer of income no longer gets a rank after the smallest shop.
- Säästövinkit shows a figure like "7,7 kuukautta" whole, and Tilanne stands on one row.

Look

- Kauppiaat no longer numbers a shop that only paid you money; a shop with a refund keeps its number.
- The tick rows above and below a page show only on pages laid out in the twelve columns (Yhteenveto and Laskut).
- The category of a row in Tapahtumat, the search of Kauppiaat on a phone and the hint of a new rule read whole instead of being cut.
- Säännöt shows no column heads while it has no rules.
- The second line of a shop in Kauppiaat starts under its name.
- Panels that hold only their name (Salasana, Tekniset asetukset) no longer have an empty ruled body under it.
- Laskut has no empty half beside Sopimukset ja laskut: the half-width panels stand as two columns.
- Folds open with a chevron instead of the browser's triangle, and Päättyneet maksut has a name strip like the other panels.
- Harvinaiset laskut on a phone keeps dates and names on one line and shows the paid state under the payee.
- Säästövinkit shows a figure such as 7,7 kuukautta whole, in the size of the other figures.
- Raportit: Tulot ja menot has one name strip, and the table key stands beside its heading.
- Säästövinkit: the figures of Tilanne stand in one row on a wide screen.
- Tapahtumat prints the number of transactions the same way in the summary and under the list.

## 0.26.0

- A page whose data did not load looks the same everywhere now: one card with the reason and a retry button. Tapahtumat no longer shows an empty table head or a download link for rows that did not come.
- The loading page and the first-run pages were checked in pictures and tidied: the frames stand in one column, the wizard's last step has a clear main button, and a refused sign-in marks its fields.
- The README's picture shows the look of today.

Look

- A page that cannot load its data now shows one card with the reason and a retry button, the same on every page. Transactions no longer draws an empty table or offers a CSV file for rows that did not come.
- The loading page is one column of dashed frames, like the overview, and the column ticks above and below a page show only where the page stands on them.
- The last step of the first-run wizard now has the main key where you go on, and its two status labels line up with the values above them.
- The steps of the Enable Banking checklist start with a small square, empty or filled, instead of a ring; after a wrong password both sign-in fields are marked.

For developers

- `pnpm shots` takes a picture with finite animations run to their end, so a night picture no longer catches a button half way between the two looks.
- `pnpm shots --answers` can fail a path with the server's error (`{ fail: { status, body } }`) or hold it back (`{ hold: true }`), so the error and loading states of a page can be pictured; `tools/shots-examples/` has a module for each state of the first-run form, sign-in, the password change and the first-run wizard.
- The picture of Yhteenveto in the README shows today's look, and the unused first-run picture is gone.

## 0.25.0

- The waiting mark is on every button that waits for its own request. In a list only the button that was pressed carries it; the others are just held.
- The maintenance helper's run each minute is lighter: it starts about a third of the processes it did.

Look

- The waiting mark is now on every button that waits for its action.

Maintenance

- The maintenance helper checks the permissions of its files and reads .env and its policy with a few processes instead of several hundred, so each minute's run is quicker; it refuses the same files with the same message.

For developers

- `pnpm check` no longer runs a step that already ran green on exactly the same files: types, lint, the core, web and server tests, each other test file under `tools/` and each shell suite leave a stamp keyed by the content of the files they read, on a clean tree only. a step with a skipped test, a changed install or a file touched during the run leaves none. `CHECK_FRESH=1` runs everything; the release gate does.
- `pnpm e2e` no longer runs a whole page test run that already passed on exactly the same files: it prints one line from the stamp. A run that can be stamped builds the app itself first, and a stamp is written only when every test passed on its first try and none was skipped. A run with an argument reads and writes none, and `CHECK_FRESH=1` reads none. The run builds into a folder of its own that it removes at the end, so a check beside it never sees a half-built `dist`; a run without a spec argument fails on a committed `.only`.

## 0.24.0

- Tapahtumat: the readouts above the list stand in three even columns, and the controls of the filter row sit on one line.
- A button that waits for its request is marked with a hatch, and a screen reader is told that it is busy.
- The last of the old animations are gone: the pictures of the front page no longer draw themselves in.

Look

- Nothing draws itself in any more (the next-days line, the credit arc); a button that waits shows a still hatch and says it is busy.
- On Tapahtumat the three readouts stand in equal columns on a wide page and the filter row's controls share a baseline.

## 0.23.0

- Nothing a user sees changed in this release. Its notes first named three changes of the look (the readouts of Tapahtumat, the mark of a waiting button, the old animations) by mistake: they were not in it, and come in 0.24.0.

## 0.22.0

- Raportit, Lainat and Säästövinkit are drawn in the same measured look as the front page: ruled tables, readouts in one row, a bracket where the rows of a table add up to its total, and findings in frames with their euros in a column of their own.
- Asetukset, the sign-in page and the first-start wizard follow the same look: ruled tables, forms of a readable width, a credit bar with a quarter scale, and the wizard's steps numbered in its title strip.
- A large sum is typeset: the whole euros at full size, the cents and the unit smaller and quieter.
- A sum bracket no longer runs past the rows of an opened category: it stands only beside the rows that add up to the total.

Look

- Asetukset: tables ruled like the other pages, hour buttons as keys, and the credit-limit bar is taller with a quarter scale.
- The sign-in page, the first-run wizard and the loading, empty and error states follow the new look.
- Raportit: the readouts, tables and tabs follow the new look, with column rules, and a bracket on a printed total only when the rows above it add up to the cent.
- The Lainat report and the loans in Asetukset have the new look: totals as figures, a warning in its own box, each loan under a rule.
- Säästövinkit: each finding sits in its own frame with the euros at the right, the situation figures use the new type, and the tone of an observation is a badge instead of a coloured edge.
- Sums in large type now show their decimals and unit smaller on Yhteenveto, Laskut and Raportit, and the sum bracket of the category tables stops beside an opened theme's own lines.

## 0.21.0

- The front page, Laskut and Tapahtumat are drawn as measured sheets: every panel has a title block, rows that add up to a printed total carry a bracket and a share mark, category bars stand under a ruler, and charts have tick marks and a drop line at the newest value. A mark is shown only when the figures behind it hold to the cent; otherwise it is left out.
- On a phone the pages are reached from a tab bar at the foot of the screen, and every page ends with a sheet foot that says which version and which view it is.
- Tapahtumat shows a loading state while its rows are fetched, and the card picture on the front page no longer tilts.
- Movement on the pages is a short fade only; nothing slides or grows.
- A release now holds a lock while it is checked, so other checks on the same machine wait instead of slowing it down.

Look

- Varallisuus and Erääntyvät maksut are measured: each account shows its share of the total and a bracket when the accounts add up to it; the line of days has ticks, weekend bands, a scale for the balance and the days to payday; a card picture no longer tilts.
- Yhteenveto's housing, income and spending, and notices blocks get ruled title blocks, a euro ruler over the category bars, column rules, and sum brackets and share tracks that appear only when the figures add up to the cent.
- The navigation is a rail that stays at the top of the screen; on a phone the pages are a tab bar at the foot. Every page ends with a line giving the release, the view and the day.
- Charts have ticks on every axis, square columns, a line from the last value down to its day, and dashed lines for the second and third series.
- Laskut is laid out in two columns on a wide screen: the bills next to the subscriptions, each table with ruled figure columns, sum brackets and share tracks where the figures add up, and a disc or ring before each due day.
- Tapahtumat shows how many rows of all are on screen beside "Näytä lisää"; Kauppiaat numbers its merchants by sum and rules its figure columns; on a phone the answer to a category change stands above the tab bar.
- Pages fade in when they open, a figure that changes eases in, and dialogs and opened rows appear softly. Nothing moves if your system asks for reduced motion.
- The sum bracket in Laskut's subscription table now stands beside the Kuussa figures it adds up, and no table row is painted dark by it.
- The head of a panel is a ruled title block: the name, then room for a date or a total, then the panel's own control.

For developers

- `pnpm e2e` waits while a release cut holds the repository lock, and says so, instead of running beside the cut's checks.
- A release cut holds an exclusive lock on `cut.lock` (and `cut.wait`, its place in the queue) in the git common dir while the gate and the proof run, and tells its children so; `tools/check.sh` stands behind a waiting cut.
- The gate, the page tests, the proof and the public tree are each told a share of the cores, and the shares add up to at most the cores.
- The public tree's type check and tests run side by side in the gate, after its build, and both logs are kept.
- A wait for a check slot is written to `lead-logs/slots.log` in the git common dir.
- The release and gate shell suites are split into scenarios, so the check runs each as a job of its own.
- The local proof before a release runs drills 1, 2, 5, 6, 9 and 10 beside the upgrade rehearsals, on an install of their own (port 8280), and drills 3 and 4 in lane 0 on the default install of the newest rehearsal. It ends with a list of where the time went, and is green only when every leg said ok. `UPGRADE_UNTIL=update` ends an upgrade rehearsal after its first update, `DRILLS_ONLY` picks the drills.

## 0.20.0

- A new look, light by default: a calm mid-light page with framed panels, capital panel names, typeset figures and a double rule under totals. Nothing glows and nothing blurs, and every text, line and state colour is checked for contrast against the surface under it.
- The checks that guard a release run faster on this machine: lint and type checks side by side, shell suites on more cores, the longest test files split.

Look

- The app is light by default: a calm grey bench, paper-coloured panels with a hairline frame, corner marks and a name strip in capitals, flat tabs and sunk fields. The night colours remain for pictures and tests only.
- The light look is a step darker: the page, panels and lines sit a little lower, so the screen is less pale and text and lines read more firmly.

For developers

- `pnpm check` runs the four type checks side by side, lints shell files in parallel and starts more shell jobs on a large machine.
- A check waits while a release is being cut and runs afterwards.

## 0.19.0

- The night look is lighter and easier to read: the page and its panels are a deep blue-grey instead of near-black, with clearer steps between them, and every text and state colour is checked for contrast against the surface under it.
- Releases are checked on this machine before anything is public: the public tree's type check, build and tests are part of the local gate, and the run on GitHub only builds, tests and signs the image and publishes.

Look

- The night look is lighter: a deep blue-grey instead of near-black, with clearer steps between the page, the panels and their edges, and panels with a softer glow and shadow. Text, state colours, charts and input edges keep their contrast against the new surfaces.

For developers

- The release gate now also exports the public tree to a temporary folder and runs the offline install, the type check, the build and the tests there, beside the private tree's checks, so a test that only fails in the public tree is caught before the push.
- `pnpm check` runs its four steps side by side (`CHECK_SERIAL=1` keeps the old order), and the shell suites use 12 jobs on a machine with 24 CPUs or more.
- `pnpm e2e` defaults to a third of the CPUs as workers (3 to 8) and, as root, runs in a network of its own, so a container starting beside it cannot break a page test.
- The local release proof starts a baseline's install from a kept image, named by the full hash of the baseline's commit, instead of building it every time (`PROOF_FRESH=1` builds it anew), and it runs one lane for every 4 CPUs by default.
- Each rehearsal of the proof logs the seconds of its phases, and every drill logs its own.

## 0.18.0

- Varallisuus on the first page shows accounts, loans and cards side by side. A card's face tilts toward the pointer, and a card with a limit has an arc of the share of its credit that is used.
- Erääntyvät maksut draws the days from today to payday: each payment is a dot sized by its sum, and the balance steps down under it. A bill you typed is a full dot, an estimate a hollow one.

Look

- Varallisuus on Yhteenveto has the new layout: Tilit and Lainat side by side with the credit cards in a row under them, and a household with no loan gets Tilit and its cards side by side. A card's face tilts toward the pointer with a band of light, and a card with a limit has an arc of how much of it is used.
- Erääntyvät maksut on the first page now shows the days to the next payday as a line. Each bill is a dot, larger for a larger sum, and under the days the balance steps down by what is paid. A bill you typed in is a full dot, a bill the app estimates from your bank rows is a hollow one. The dots can be reached with the arrow keys, name the payee, the sum and the day, and light their row in the table.
- The bill of a credit card in Erääntyvät maksut has the card's plain name, as in Varallisuus, without the type the bank adds in brackets.

## 0.17.0

- The whole app has the new dark look on every page, and its panels have a lit top edge, a faint glow inside and a deep shadow.
- The work behind a release is arranged side by side: the run on GitHub starts its checks, tests and image builds together, and the local proof builds the image beside the upgrade rehearsals.

Look

- In the night look, panels have a lit top edge, a faint glow inside and a deep shadow.
- The whole app has the new dark look, on every page from the first page to Settings and the sign-in.

For developers

- The release run on GitHub starts the type check, the tests (in three shards) and both image builds together instead of one after another, and a test of the workflow reads that no tag, signature or release is made before all of them have passed.
- The local proof of a release builds the image and runs the smoke test beside the upgrade rehearsals instead of before them, waits 5 s instead of 20 s for the helper's look at a stopped app in the watchdog drill, and takes `PROOF_JOBS=1` to run its legs one after another on a machine that is too small.

## 0.16.0

- Nothing on the pages changes in this release. It makes the work behind the app faster: the release command runs its two longest local steps side by side, and a page test that failed now and then no longer stops a release.
- The stylesheets every page shares read both looks from one set of tokens, so the night look can be switched on for the whole app in the next release.

For developers

- The release command runs the gate and the local proof side by side, and the gate runs `pnpm check` and `pnpm e2e` side by side after the build.
- A red `pnpm e2e` in the release gate is repeated once on its failed tests alone: green passes and names each test as flaky, red again fails.
- Landing a wave of branches, cutting a release, looking at the state and watching the workers are one command each, and each prints only what needs a decision.
- The page tests' sideways-scroll check waits for the layout to settle before it reads, so a chart still one frame behind a window resize no longer fails a run now and then.

## 0.15.0

- The first page shows what the money goes to. Menot kategorioittain is a table of the main classes (Ruoka, Asuminen, Auto and so on) over the last twelve complete months: a figure a month, a figure a year and the change from the year before. A class opens to its lines, and large purchases stand apart under the table.
- A credit card has its picture again on Yhteenveto: a card face in gold, platinum, black, silver or plain, chosen from the card's name.
- Raportit states its figures in rows. Kiinteät ja muuttuvat, Saldot, Tulot and Lainat lose two charts and their explanatory paragraphs, the income table holds only the months that came, and a connected credit card is shown as a card with its used credit and limit, not as a loan.
- In Tapahtumat the payee's column is Saaja/maksaja and the account has a column of its own, Tili.

Money and reports

- Yhteenveto: "Menot kategorioittain" shows what the last complete months (up to twelve) went to, theme by theme, with a figure a month, a figure for the year when twelve months are there and the change on the year before when it can be told. A theme opens to its lines, and the large purchases stand under the table.
- That table stays the same when you pick another month in the block; a household with under three complete months keeps the month's list.

Look

- A credit card has its picture again on Yhteenveto: a gold, platinum, black, silver or plain card drawn from the card's own name, with the bank's logo and the last four digits, at the left of its rows.
- Raportit lost two charts and several sentences: Tulot has its months as a table and no chart behind a button, and Kiinteät ja muuttuvat has its figures and no chart or paragraph. Saldot and Tulot ja menot keep their charts.
- Fixed costs a month and their share of the income are figures in Kiinteät ja muuttuvat, and the three accounts-less-debts figures in Saldot are rows with a label at the left.
- Tulot is shown only when the history is long enough, and "Mikä muuttui" only when the income changed.
- Lainat tells a missing figure as a dash with one link, Täydennä, to the card Lainat in Asetukset. The interest and the amortisation of a payment, and your part of a loan, are figures with a label. A connected credit card shows its used credit and its limit, no loan terms.
- The column "Osuus tuloista" is gone from Kategoriat.
- In Tapahtumat the payee's column is headed Saaja/maksaja, the account has a column of its own (Tili), and the bank's text under a name is shown only when it says more than the name.

For developers

- `tokens.css` holds two sets of the same tokens, the night look on `:root` and the light look the app has on `:root[data-look="classic"]`, which `index.html` selects, so no page changes yet; `contrast.test.ts` runs every bar on each set, IBM Plex Sans 300 is bundled, and `pnpm shots --look classic|c` takes a picture in either look.
- Core has themes, the main classes above the categories: `themeOf` in `packages/core/src/themes.ts` gives every row of spending one theme and one line in it, and the themes of a period add up to its Menot. No page shows them yet.
- Core answers what goes where: `themesReport` in `packages/core/src/analysis/themes-report.ts` sums the themes of the last twelve complete months, each with its lines, a figure a month, a figure for the year and the change against the year before, and holds large purchases apart. The first page's answer carries it as `themes`, `pnpm findings --source themes` prints it, and no page draws it yet.

## 0.14.0

- Asetukset is one plain page: Pankkiyhteydet, Tilit, Talouden jäsenet, Lainat and Salasana. Everything technical (the server, the bank link's application, remote access, the security log, maintenance) is on a page of its own behind one card, Tekniset asetukset.
- Laskut, Tapahtumat, Kauppiaat and Säästövinkit state their figures in rows and tables. The explanatory sentences, the counts and the lists of what was not found are gone, and Säästövinkit shows the tips first.
- A large payment to a car dealer is a category of its own, Auton osto, and no longer groceries or uncategorised. A payment of 1 000 € or more that has no category is a row of Ilmoitukset with the link Luokittele.

Money and reports

- A new category, Auton osto: a payment of 1 500 € or more to a car dealer is the purchase of a car, and a smaller payment to a dealer stays in the car's running costs. You can also pick the category yourself for any row.
- Ilmoitukset shows a payment of 1 000 € or more that is still in Muut menot as "Luokittelematon maksu", and its link Luokittele opens the row in Tapahtumat, where you give it a category.

Look

- Tilit in Asetukset no longer scrolls sideways in a window between a phone and about 760 px wide: the type and the user of an account sit under its name there.
- Asetukset is one plain page for everyone: Pankkiyhteydet, Tilit, Talouden jäsenet (admin), Tilien jakaminen, Lainat, Salasana and a card Tekniset asetukset. The tabs Omat and Talous are gone.
- Tekniset asetukset holds the rest on a page of its own: Haku pankista, Tietojen laatu, Omat istunnot, the member's own Enable Banking application, Esimerkkitiedot and, for an admin, Palvelin, Turvallisuusloki and Ylläpito.
- Hae nyt is in the head of Pankkiyhteydet and only shows while a bank is connected. Vaihda salasana is a button in the card Salasana.
- Without the maintenance helper, Ylläpito shows the notice, the version and Tyhjennä kaikki tiedot; the controls that cannot work are no longer folded behind a line.
- Tietojen laatu is a card only while the data has a note. Old addresses (`?tab=talous`, `?section=security`, `#laatu`, `#kirjautuminen`, `#turvallisuusloki`) open the card they named.
- Asetukset > Tilit no longer has the "Haettu" column or a provider word after the account number, and an empty list reads "Ei tilejä."
- The cards of Lainat, Tilien jakaminen, Etäkäyttö and Tyhjennä kaikki tiedot lose their explanatory sentences; the reset card keeps three plain lines.
- A bank connection says how many days of its consent are left only when fewer than 30 are.
- With the maintenance helper off, Etäkäyttö shows only the command that sets the helper up and the link to its guide.
- Laskut states its figures in rows and tables. The first line is two rows, Kiinteät menot kuukaudessa and Tilaukset kuukaudessa, and no card has a sentence under its heading.
- Erääntyvät maksut on Laskut is a table with the heads Eräpäivä, Saaja and Summa, lists every payment of the 30 days (there is no Näytä kaikki) and has no category line under the payee.
- Tilaukset is one list, the ones asked about first. Its row Yhteensä has the sums of Kuussa and Vuodessa and leaves out the ones marked as stopped, which stand below it. A series table says the category alone under the payee and has no column Jatkunut.
- Hinnanmuutokset has the columns Saaja, Muuttunut, Aiempi hinta, Uusi hinta and Vuodessa and ends in a row Yhteensä, with the loan instalments in a row of their own. Harvinaiset laskut shows the monthly figure at the right of its heading and the twelve months as a table.
- The fold of the series that have ended is Päättyneet maksut, with no count, and the form for a bill has one line of help.
- The banner under the header about how joint accounts are counted is gone, and so is the paragraph of the empty start page: it has its heading and the two buttons Yhdistä pankki and Lataa esimerkkitiedot in one row.
- Tapahtumat shows its count and its two sums as three labelled figures, Tapahtumia, Maksettu yhteensä and Saatu yhteensä, in the form of a merchant's card; the sentences about own transfers, joint accounts and how a merchant's figures are counted are gone. A merchant's card keeps its figures, and the list does not repeat them.
- Kauppiaat has no sentence under its heading and no switch between all merchants and Arkiostot; a link that asks for Arkiostot shows a chip with a × that takes it off. Luokittelematta no longer counts its merchants, and Säännöt has no explanation under its heading.
- An empty Tapahtumat says "Ei tapahtumia." with a link, Yhdistä pankki, to the page where a bank is added.
- Säästövinkit shows the tips and their figures first and no longer lists what was not found. The line with the date of the data, the months of history and the accounts, the Alueet heading with its two folds of checked and waiting items, and the sentences on how the sum was counted are gone. A tip shows its certainty only when it is not high. At 390 px the first tip is on the first screen.
- Tilanne gives the euros a year as the first of its figures, "Säästömahdollisuus vuodessa (arvio)", followed by "Vaihteluväli" when the tips' range is wider than one figure. Without a tip it says "Ei vinkkejä." An area's figures show only on an area that has a tip.
- A tip no longer shows how long it takes or the assumption behind its euros, and a tip with euros shows its deadline as "Määräaika" on a line of its own. Muut havainnot keeps the first sentence of its advice and drops the line about the first charge. The inputs Säästövinkit asks for show their name and the field, no longer what they unlock or the area. Seuranta draws its chart from four months of history.

## 0.13.0

- Yhteenveto is laid out anew and reads as a bank statement from top to bottom: Varallisuus, Erääntyvät maksut, Asuminen, Tulot ja menot and Ilmoitukset. Accounts, credit cards and loans are plain rows that each end in a total; the drawn card, the fold of other accounts, the fetch times and the banners are gone.
- Erääntyvät maksut replaces the payday card and its forecast of a balance for each day: it shows the balance today, the payments due before the next payday and what is left after them. A bill you pay when the pay arrives is expected on the payday, so it no longer makes an account look short.
- Asuminen is a new block: each home loan with its next payment, its rate as the reference rate and the margin, and the day the rate is set again, then the rent and the charges of the home and what the home costs a month.
- Money that comes in no longer turns spending negative: a refund lowers the spending it takes back and anything else is income, so the rows of Menot kategorioittain add up to Menot.
- The pages are a step darker with stronger contrast under a dark header, and the loan reader in Asetukset > Lainat fills the form from a screenshot of a bank's loan view.

Money and reports

- A monthly bill is expected on its usual day of the month, and a bill you pay when the pay arrives is expected on the next payday, also when a weekend moves the pay. Such bills are no longer counted as due before the pay, so Erääntyvät maksut on Yhteenveto does not show the account short because of them.
- The list of the next 30 days on Laskut is named Erääntyvät maksut, as on Yhteenveto, and has two groups, each with its sum: the payments to the payday and the payments after it. With no payday known it is one group, Seuraavat 30 päivää. What a credit card is charged is a group of its own, Kortilta veloitettavat, so the first group adds up what the accounts pay, as the figure on Yhteenveto does.
- The loan reader in Asetukset > Lainat now fills the form from a screenshot of a bank's loan view ("Lainan tiedot"): the sum left, the granted sum, the lender, the way of repayment, the last due date and the kind of loan.
- Money that comes in on a spending category no longer makes spending negative by itself: it lowers spending only as a refund from a payee you paid in the 120 days before, and anything else is income (Hyvitykset, or Maksut henkilöiltä when it comes from a person). A category you set by hand on money that came in stands: the row lowers that category.
- The rows of Menot kategorioittain add up to Menot in every view and month, and the chart of cumulative spending keeps a line that runs below zero inside its frame.
- Yhteenveto has the block Erääntyvät maksut in place of the payday card: the balance today, the payments due before the next payday and what is left after them, then the payments one by one and the pay that is to arrive.
- The block no longer draws a balance for each day and no longer takes everyday spending off the balance. The usual spending of a day is one line of context: the median of the last 13 whole weeks, and no line under eight weeks of history.
- A household with two salaries waits for the nearest one: the payday is the next regular income of at least half the largest one. A small regular income, such as a benefit, does not end the window; when it lands in the window it is a row of Saapuvat maksut.
- A pay that is late, or behind its day and not late yet, ends no window: the block still looks to the day before the next salary whose day is to come, and the payments due before it are listed.
- One warning names the day of the first payment that the balance, with the pay that comes before that day, does not cover, and the most that is missing.
- With two checking accounts in view the three figures need the balance of both; without one of them the block says Tilin saldo ei ole tiedossa and lists the payments.
- A card's bill and a regular transfer to an own account are rows by the card's or the account's name, with the line Luottokortin lasku or Oma siirto under it. The line under Saldo says which accounts the balance counts.
- Yhteenveto has a block Asuminen: each home loan with its next payment, its rate as the reference rate and the margin, and the day the rate is set again; then the rent and each charge of the home (vastike, water, electricity) with its payee, and what the home costs a month in all. Where a payment comes from a joint account the row is your part, and one line says so.
- A household with no home loan, no rent and no right-of-occupancy charge is asked once whether it has a home loan: "Lisää asuntolaina" opens Asetukset > Lainat, and "Ei asuntolainaa" ends the question for that member and removes the block when there is nothing else to show in it.

Look

- Yhteenveto shows a credit card as its name with rows under it, like a loan, and no longer draws it as a card. Every account has its own row, nothing folds away, and each column ends with its total (Tilit yhteensä, Luottokortit yhteensä, Lainat yhteensä).
- The line under Yhteenveto about accounts and fetch times, the fetch time in the header and the line about your part of a joint account are gone. Ilmoitukset is one line a row, four rows at most with a link "Kaikki" to Säästövinkit, and a sign-in from a new device is its first row, cleared with Kuittaa, instead of a banner on every page.
- Yhteenveto reads as a statement from top to bottom: Varallisuus, Erääntyvät maksut, Asuminen, Tulot ja menot and Ilmoitukset, each the width of the page. Asuminen is tables in place of sentences: Lainat with the rate, the reference rate and margin, the review date and the next payment split into amortisation and interest, Asumiskulut by payee, and the three monthly sums beside it. A value that is not known is a dash with the link Täydennä.
- Tulot ja menot shows the two months side by side in one table with the savings rate and the fixed costs under it, and Menot kategorioittain as a table whose rows open the category's rows in Tapahtumat. Erääntyvät maksut has its three figures at the left and the payments at the right. The comparison sentences, the strip Tulojen käyttö (it stays in Raportit) and the line of usual daily spending are gone from the page.
- The pages are a step darker with stronger contrast, under a dark header.
- The month switch moved from the top of Yhteenveto into the head of Tulot ja menot, the only block it changes. Varallisuus and Erääntyvät maksut always tell today, also when the month before is chosen; `#/overview?period=last-month` still opens it.
- "Kategoriat" is now "Menot kategorioittain", "Mihin tulot menivät" is "Tulojen käyttö" and "säästöön 9 %" is "säästöaste 9 %".
- What needs you on Yhteenveto is one list, Ilmoitukset, in a card at the foot of the page: the warning about the data first, then the alerts, then the insights while Säästövinkit is switched off. Before, the warning, the alerts and the insights were three blocks of coloured tiles. Only a warning is marked, with a rule at the left edge; with nothing to show there is no card.
- A notice has its title and detail at the left and its buttons (Kuittaa, Käytössä, Lopetettu) at the right, under the text on a phone. The buttons do what they did.
- Varallisuus on Yhteenveto has the look of a statement: Tilit, Luottokortit and Lainat stand in three columns from a window 1040 px wide (two or one when a group has nothing, under each other in a narrower window), with rows of one height and the sums on one right edge.
- The name of an account or a card opens its rows in Tapahtumat, and the name of a loan opens the report Lainat. A name keeps its own colour until it is pointed at or focused.
- Lainat has its own sum, "Lainat yhteensä". "Velat yhteensä", the loans and what the cards owe together, is a row under all three columns when a card has something used.
- A bank's logo no longer stands before an account's name, and a card over its limit says so in a plain row, Luottoraja ylitetty.

For developers

- A self-check for a signed-in admin, `tools/audit/self-check.js`: run in the browser console, it lists where figures that must agree do not, with category ids, months, counts and sums only.
- The dashboard answer has `housing`: the household's home loans as Varallisuus > Lainat has them (the month, the next payment, the rate with its reference rate and margin, the review day), loan payments that no saved loan is linked to, and the rent and the charges of the home, each named by the words of its latest payment. No page shows it yet.
- `loanNextPayment` tells the due date of the next payment (`NextPayment.date`), null where no plan places it.
- A loan saved with a fixed rate keeps no review day: the route drops a day sent with one.

## 0.12.0

- A joint account now counts at your part. In Asetukset > Tilit you say who uses an account and at what parts, equally or by what each pays into it in a month. Your own view then holds your part of its balance, of its payments and of the loan paid from it, and Koko talous holds it whole.
- The pages say when a figure is a part: an account's row reads "Yhteinen tili, osuutesi 60 %", Tapahtumat shows the bank's amount with your part beside it, and Tulot splits the income of a joint account between its users.
- Koko talous holds a loan your partner typed in when it is paid from an account you both see, marked "Lisännyt" with the name. A loan you both typed in counts once.
- The payday card lists the credit card's bill and your regular transfer to a joint account, and says which accounts it counts.
- A loan can hold the day its rate is next reviewed (Koron tarkistuspäivä).

Money and reports

- The days to the payday now follow the checking accounts whose balance they start from. A bill or a subscription counts when one of those accounts pays it, and the usual everyday spending is what those accounts paid themselves.
- The bill of a connected credit card is a row on its usual day: what the card owes today, or the usual bill when the card is not paid in full or the last bill is late. The card's purchases are no longer in the everyday spending.
- A regular monthly transfer to an account outside the balance (savings, a joint account) is a row on its day. A transfer between two counted accounts changes nothing.
- In a member's own view the balance is that of the accounts the member uses alone. A member whose only checking account is joint gets it at their part.
- A bill you typed in is no longer dropped because another bill of the same payee or a similar sum was paid. It is dropped when a payment that belongs to no subscription or bill has its name or its size, or when the bill of that name and size is already expected from the history.
- Oma talous counts what a member uses. A joint account counts at the member's part: its rows, its balance and its credit limit, in the overview, every report, Laskut and the report exports. The parts of the users add up to the account, to the cent. An account somebody else uses alone counts nothing, and money moved to or from it is money between people.
- Money a user pays into a joint account is a transfer in Oma talous, not income: it pays for that user's part of what the account pays.
- Koko talous counts every account whole, as before. It now also exists for a member nobody shares an account with, when one of their own accounts has other users.
- Tapahtumat lists the bank's rows whole in both views. In Oma talous the sums above the list, the merchant sums of Kauppiaat and the unrecognised spending add up the member's parts, and each row of a joint account carries the part as `partCents` in `/api/transactions`. The transaction export keeps the bank's amounts.
- Säästövinkit reads the accounts a member uses whole in both views: a contract is the household's.
- In Oma talous the sums of Tapahtumat and Kauppiaat count a row as the overview does. Money a user pays into a joint account is a transfer there too, and money to an account somebody else uses alone is money to a person. The category filter, a merchant's summary, the unrecognised spending and the Siirto column of the transaction export follow. The amount on a row stays the bank's.
- Oma talous never pairs two rows of one member again. A payment that came back and an equal sum on another account of the same member stay as that member's categorisation left them. A household where no account has other users sees the rows and figures of 0.10.0 in Oma talous.
- `/api/merchants` and `/api/merchants/uncategorised` take `scope`, and Koko talous counts the member's rows whole there. Kauppiaat and the unrecognised spending of Tapahtumat pass it.
- A debt follows who uses the account behind it: a card or a loan account counts at the viewer's part of it, and a loan typed in at the part of the account its payments leave. So the own figures of each user of a joint account hold their part of a mortgage paid from it, whichever of them typed it in, and the parts add up to the cent.
- Tulot in Koko talous splits the income of an account with several users between them by their parts, and counts an account one member uses as that member's, whoever linked it.
- A proposed loan tells the bank's whole payment in every view, so a loan saved in one view is not proposed again in the other, nor to the other users of the joint account it is paid from.
- Koko talous holds a loan another member typed in when the loan is paid from an account in the view, a joint account or one that member shared, and counts it whole. So for members who see the same accounts the two own views add up to Koko talous, whoever typed the loan in. Before, the other member's Koko talous owed less than their own view. A loan with no payments linked stays its typist's alone.
- A loan both members typed in, each from their own papers, counts once: a view shows the viewer's own and leaves out the other member's loan paid by the same series of payments.
- A loan another member typed in says so on Yhteenveto and in Raportit > Lainat ("Lisännyt Aino"), and is not offered for linking to an account. Only its typist can change or remove it, in Asetukset > Lainat.
- In Koko talous the Lainat report no longer says that only the viewer's own saved loans are in it, and the Saldot line calls them saved loans in both views.
- Oma talous no longer counts the bill of a card as spending on top of the card's purchases when one partner linked the card and the bill is paid from an account the other partner linked, such as a joint account both linked. The bill is a transfer there, at your part of the account, and the payday card expects it as the card's bill.
- The payday card keeps the day a pay was expected when that day has gone by and the pay is not late yet, and says the pay has not come. The note under a card's bill that is estimated from earlier bills reads "Arvio aiemmista laskuista".
- Asetukset > Tilit has a Käyttäjä column: who uses each account. The bank's holder names are chosen already, so most households change nothing. Choosing saves at once; "Palauta pankin tiedoista" takes a said answer back.
- A joint account has "Tasan" or "Omat osuudet" under it, with a field in euros a month for each user and what they come to in percent. The page proposes the euros from what each user paid into the account in the last months, and one press takes them.
- When a member is named as a user of an account but cannot see it, the page says so and offers "Jaa tili".
- After a bank is linked, a card above the accounts asks who uses a new joint account, with the bank's answer chosen. Under "Tilien jakaminen", an account shared with you tells your part of it.
- Koko talous is offered as soon as you have a part of a joint account, also when nobody shares anything with you. In Oma talous a line under the header says joint accounts are counted by your part, and Koko talous says they are counted whole.
- Yhteenveto marks an account, a card or a loan you have a part of ("Yhteinen tili, osuutesi 60 %", "osuutesi 60 %"); Saldot and Lainat do the same. A row of a joint account in Tapahtumat shows the bank's amount and your part beside it, and a line says the sums above the list are parts.
- The payday card lists the bill of a connected card and a regular transfer to an account outside the balance, each with its own line, and its payments figure holds them. The foot says which accounts the balance counts, and no longer says that own transfers are left out.
- Tulot says that a joint account's income is split by the users' parts. Kauppiaat and the unrecognised spending of Tapahtumat follow the view you picked.
- Asetukset > Lainat has a new field, Koron tarkistuspäivä, for the day the bank sets the loan's rate again. It is shown unless the reference rate is Kiinteä korko, it is never required, and a day that has passed is kept.

For developers

- `pnpm shots` takes several routes in one run at four widths, links the fake bank (`--fake-bank`), shows a changed answer of the API (`--answers`), runs steps before the picture (`--steps`) and sets the view (`--scope`). See "Pictures of a page" in docs/DEVELOPMENT.md.

Upgrade

- From the first start a member's own figures count their part of an account with two holders. Koko talous counts it whole, as before.
- Migration 0019 runs on the first start, after the usual copy. It adds the review day of a loan's rate, empty for every loan there is.

## 0.11.0

- The first page is now Yhteenveto and opens with Varallisuus: your accounts with their total, your credit cards with the credit used, the limit and what is available, and your loans with what is left and the monthly instalment. Its two buttons name the months they show, such as Lokakuu 2026.
- The forecast to the month's end is gone, because its range was too wide to help. The card Menot shows what the month has cost so far beside what the month before had cost by the same day, from real rows only.
- More payments are sorted right. A hairdresser, a taxi, a town or a company whose name reads like a person's is sorted by its trade again, and a loan at your own bank that is paid like an invoice counts as a debt payment. Past months are sorted again on the first start, so their figures change with it.
- The trade register is never asked about a name that holds a word of your household's own names, and only a merchant's name is ever sent to it.
- An update says so when GitHub's limit of requests was met, and two installs on one Docker no longer stop each other's update.

Money and reports

- A payment to a hairdresser, a cleaner, a florist, a taxi, a physiotherapist, a kennel, a pizzeria or a town that is named like a person ("Kampaamo Liisa", "Helsingin kaupunki") is sorted by its trade again, not as a payment to a person.
- A company with its form in the middle of its name, a school and an association ("Bostads Ab Exempel", "Esimerkin koulu") are no longer taken for a person.
- A MobilePay payment to a person on a card account is a payment to a person also when the row begins with the country and the town.
- A card purchase from a company whose name holds a word of credit (a car workshop called "Autorahoitus") is a purchase by its card code, not a loan payment.
- A loan at your own bank that is paid like an invoice, with a reference number and no text beside it, counts as a debt payment when the same sum is paid under that reference month after month. Only payments to the bank itself count: a company that shares a word with your bank's name, such as its fund company, is not taken for the bank.
- Another bank of the same kind as yours (another savings bank) is no longer read as your own bank.
- Credit drawn from the issuer of a connected card no longer makes that card's bills count as spending a second time.
- When a new card replaces an old one and is paid the same way, the new card's first bill counts as spending once a later bill of the new card has been matched with the card's own payment row: the purchases it pays for are in no data. Until then it is taken for a payment between your own accounts.
- The server works out who uses each account. A joint account is its holders' in equal parts, by the holder names the bank gives, and any other account is the member's who linked it. `/api/meta` tells it for each account as `use`, with the viewer's `part`. No figure counts by it yet.
- The member who linked an account can say who uses it and at what weights, and take that back (`PUT` and `DELETE /api/accounts/<id>/use`). One statement holds for the real account, so both partners' copies of a joint account read the same. No page offers it yet.
- A part that was said of an account stays when a member is removed: the others keep the same ratio, and the removed member's share goes to the account's holders who are not users of the app.
- An invoice (a payment to an account with a reference number) to a payee whose name does not say it is a business, such as the one word `Zorro` or `A&B Esimerkki`, now takes the category of the company's industry when the household also pays the same shop by card. An invoice alone does not make such a name a business, so it is not looked up. An invoice to a name that reads as a person's stays as it was sorted.
- Security: the trade register is never asked about a name that holds a word of the household's own names. Those are the holders of its accounts as the bank gives them and the members' display names, so a relative's firm and a shop named like a member are not looked up, whatever the row says. A word is matched as the bank writes it, so a firm named with the surname in the genitive (`Meikäläisen Huolto`) is still looked up.
- Security: only the name of the merchant is sent to the register, never amounts, dates or account numbers. A name that reads as a person's (two to four words, none a company form or a business word) is not sent. A firm named after its owner with a company form (`Tmi Liisa Virtanen`, `Virtanen Oy`) is, as before, unless it holds a word of the household's own names.
- The forecast to the month's end is gone from the first page: its range was too wide to help. The card "Menot" now shows what the running month has cost so far, what the month before had cost by the same day ("Syyskuussa 12.9. mennessä") and a chart of both months ("Menojen kertymä"). Every figure is a sum of real rows, and the usual month is no longer drawn there.

Look

- The first page is now called Yhteenveto (it was Kuukausi), in the menu, the heading and the tab title. Its two buttons name the months they show, for example Lokakuu 2026 and Syyskuu 2026, in place of Tämä kuu and Viime kuu. Bookmarks to the page and to either month keep working.
- The first page opens with one card, Varallisuus, with Tilit, Luottokortit and Lainat in it. The groups stand side by side on a wide screen and under each other on a phone.
- Tilit starts with the total of the accounts and says how many accounts it leaves out for want of a balance. Two accounts with the same name show the last four characters of the account number. With more than four accounts, those that hold less than one euro fold into "Muut tilit".
- A credit card is a small card drawn with the bank's name, a chip and the last four digits, beside its name and its figures: how much credit is used, the limit and what is available, or by how much the limit is passed. The type the bank adds to the name in brackets, such as "(credit)", is left out.
- Lainat shows what is left of each loan and the monthly instalment as two lines, and the total under it is called "Velat yhteensä" when credit cards are in it.

Maintenance

- The maintenance scripts keep one copy of code they had several times, and the helper and the Cloudflare setup change `.env` through one library. Nothing changes for an install.
- When GitHub refuses the check for a new version because the limit of requests was met (403 or 429), update.sh says so and that an hour's wait cures it, instead of the plain "could not ask GitHub".
- Two Omatalous instances on one Docker that fetch the same version at the same moment no longer stop each other's update: the image is tagged by its id, and the pull is made once more if the other instance has removed the registry tag first.

For developers

- `pnpm e2e` runs on three Playwright workers, each with a server, data directory and fake bank of its own, so a whole run takes about half the time. `E2E_WORKERS=1` runs the specs one after the other.

Upgrade

- Migration 0018 runs on the first start. It adds a table and changes no row.

## 0.10.0

- Figures that were wrong are right. Card bills are told as card bills also for the months before the card was connected, money from the other holder of a joint account is shown as money from a person, not as earned income or savings drawn, and a lender the app did not know is counted as debt. Past months are sorted again on the first start, so their figures change with it.
- A shop has one name whatever way the payment came, the totals in Raportit agree (a category with more refunds than spending keeps its minus), and Säästövinkit counts a lease in the cost of a car and shows a car you bought apart from it.
- Kuukausi opens with what you have and owe: your accounts with their balance, your credit cards with how much of the limit is used, and your loans with what is left and the payment a month. The card below it, which looked 30 days ahead, now counts the days to your next payday: the bills before it, your usual everyday spending and what should be left on the account the day before the pay.
- An administrator can turn on "Tarjoa uudet versiot heti" under Asetukset > Ylläpito. A new version is then offered at once and not two days after its release. The update still starts only when you press Päivitä.
- The page is a little darker and easier on the eyes in the evening, the Finnish texts were read through, and the list of earlier connections is gone from Asetukset > Pankkiyhteydet.

Money and reports

- A credit card paid by bank transfer is recognised by where its payments go: the payee account and reference of a payment that paired with the card's own rows. Earlier payments to the same place are Luottokortin lasku for the months before the card was connected, where they were Muut menot. A later payment that found no pair is a transfer.
- Loan instalments under one reference stay one loan. A larger extra payment or an instalment that changed no longer turns into a card bill and then into a transfer, which took the debt payment out of its month.
- A bill is taken for a connected card's by its text alone only when nothing says otherwise: a card with a known payment channel has no other bill, and a company that paid credit out to the household is a lender.
- Money that another holder of your account moves in is no longer counted as your savings drawn. When the holder names the bank gives tell who you are (one account in your name alone is enough), an own transfer from the other holder of a joint account is money from a person, and so is everything else that person sends, whatever the message says. A payment to them is a payment to a person, and rent paid to them stays rent. Before, a holder whose first name is also a company's name was read as that company.
- A payment between people that the bank marks with its own word (Mobiilimaksu, Siirto-maksu) is money to or from a person when the name beside it is a person's. Such money in is not earned income.
- A MobilePay payment that the bank books as a card purchase (MOB.PAY* in front of a person's name) is a payment to a person. With a business behind the prefix it stays a shop.
- A travel claim or other money back whose text has a number glued to the word (Matkalasku123456) is read as a reimbursement. Before, the number hid the word.
- A lender that the app's lists do not name is told as debt. A payment to a company with a word for finance or credit in its name, or with the word bank as a word of its own (Esimerkkirahoitus Oy, Esimerkki Bank AB), is a loan payment. A name that only ends in bank (Powerbank Oy, Varaosapankki Oy) is no lender. Before, such a payment was "Muut menot", so the month looked better than it was. A card purchase, pay, a refund, deposit interest, a savings account and an insurance from such a company stay what they were.
- Money in from such a company is credit drawn when its name has a word for finance or credit. A bank is not told that way by its name: its pay, bonus or a closed deposit stays income, as before. The name alone also makes no lender of the bank of one of your connected accounts, so its small lines (a paper statement) and a card's bill with only a reference stay as they were.
- A company that has once paid credit to your account is a lender: later payments to it are loan payments, also when their text holds only a number. A person is never made a lender by a payout, and nor are you (a card's credit moved to your own account under your own name).
- A payment to a company that the trade register knows as a bank or another credit institution is a loan payment, unless it was made with a card.
- A cash machine's row that holds only its street address is a cash withdrawal. Before, a word in the street's or the town's name could make it a shop. A card purchase keeps what its merchant code says, also when its text is an address.
- Interest the bank takes with no payee on the row is interest also when the word ends a longer one (Velkakorko), but a name that only starts with it (Korkonen, Korkokenkä) is none. Tax at source on interest (Lähdevero) is a tax, and the bank's monthly services (Päivittäispalvelut) are bank fees.
- An overpayment that a lender sends back (Liikasuoritus, Ylisuoritus) is a refund and not credit drawn.
- The balance report and the month page's answer now list what the household has and owes: each checking and savings account with its balance today, each card with its limit and what is used of it, each loan with what is left and its payment a month. Nothing is computed twice: the cards used and the loans left add up to the debt total.
- A transfer to a person's account with no reference number is a payment between people (a gift, an allowance, a share of a bill), also when the person's name is a shop's brand too (Helen, Elisa). It is read as before when the payee is paid about the same sum in three or more months (rent, a childminder, a coach), when the payee is you, when the message names a purchase, an invoice or a reference number, when there is no payee account, and for money in.
- Which holder you are is now told by the name on the most connected accounts, so another person's account (a child's) no longer hides the other holder of your joint account.
- The payday on the first page follows the same pay day rule as Raportit > Tulot: a pay day that falls on a bank holiday, such as Christmas Eve, is the banking day before it, and a payer with no fixed day follows the dates of its own pay.
- The payday on the month page is right after a pay that came on the Friday before the 1st, and after a pay booked late in the next month. Before, the card could call today the payday until the next pay came in, or lose the month's pay.
- The balance before the payday starts from today's balance, the same figure as the accounts on the month page and in Saldot, with the purchases booked since the bank gave the balance. Its note now says the balance is calculated from the bank's balance of that day.
- In Kategoriat, and in the share of uncategorised spending, no share goes over 100 % when another category has more refunds than spending.
- Accounts of the type "other" are listed on the month page, so the accounts add up to the total in Saldot.
- Under Lainat on the month page one line, "Velkaa yhteensä", gives everything the household owes, cards and loans together, the same sum as in Raportit.
- The note about card bills counted as spending also shows when a card is connected, and then says the bills are from before the card's transactions or from a card that is not connected.
- In a household with two earners, each change of payer names its own new payer and its own earlier pay, and one member's pay that stopped is no longer told as a change of payer because another member took a side job on another account.
- A change of payer stays on the first page for 120 days after the old payer's last payment; the income report still shows it for twelve months.
- The bank of one of your connected accounts is no lender by its name for its own plain lines, but a finance company that carries its name (Esimerkkipankki Rahoitus Oy) is one: a payment to it is a loan payment, and money it pays out is credit drawn.
- Koron and Korot are read as interest, like Korko, on a bank row with no payee.
- When one account has two old payers and two new ones, each change of payer pairs an old payer with the new payer whose pay is nearest to it, and not with the one paid first.
- A regular payer's only payment in a pay period counts as regular pay up to the payer's usual level, also when its text says holiday pay or bonus. Only what goes above the level is shown as extra pay.
- The income report tells a change of payer, or pay that stopped, in the twelve months it shows, not only when the period ends today. A payer that stops and another that begins within two pay periods are one change.
- A shop has one name whatever road the payment took. The country and city a card account writes in front of the shop are dropped, a payment service in front of the name (Paytrail, Zettle and the like) is dropped, and a marketplace keeps its own name without the item title or order number. More purchases then reach the brand and category rules. Merchant names change by themselves on the first start after the update. Your rules by merchant name and your marks on subscriptions follow a merchant to its new name. When several merchants get one name, a mark on one of them does not carry over.
- The card on Kuukausi that looked 30 days ahead now counts the days to your next payday. Its heading names the payday and the days left, and under it stand the payments before it, the usual everyday spending for those days and what is left on the account on the last day before the pay. When the account would drop below zero, or below a day of everyday spending, that day comes first. The pay is the last line. Without a regular pay, or when the pay is late, the card keeps the 30 days and says why.
- Kuukausitaulukko and Kategoriat now show a category that got more refunds than spending in the period, as a row with a minus at the end. Their totals equal the expense in Tulot ja menot to the cent, and the change against the previous period adds up the same way.
- The Luokittelematta card on Tapahtumat counts all uncategorised merchants and adds up all of them. It used to count and add up only the 50 it lists.
- The share of Muut menot is figured on one base in Kategoriat and in the Tietojen laatu notice about uncategorised spending, so the two pages give the same percentage. The base is each category's spending less its own refunds, adding up only the categories that stay above zero: a refund in one category does not lower another.
- Säästövinkit counts a lease in the car's running cost on a line of its own, "Leasing", whatever category the bank rows were sorted into.
- A payment to a car dealer shows apart as "Auton osto". A car bought once is not a monthly habit, so it stays out of the running cost and the cost per kilometre.
- The other insights in Säästövinkit are built from the same complete months as the findings, so a yearly figure no longer stands on the first days of a month.
- A check that found no rows of its kind, such as the car costs of a household with no car, is no longer counted as checked. Tilanne counts it apart and Alueet names it "ei tietoja".

Look

- The month page now opens with what the household has and owes. Accounts are listed with their balance, each card is drawn as a card with its name and last digits and a bar of how much of its limit is used, with the used amount, the limit and what is free beside it, and each loan shows what is left and its payment a month. A card without a limit shows only the debt. A balance the bank gave more than a day ago says its date. A card named Gold, Platinum, Kultakortti or Platinakortti gets a tinted face; others stay plain.
- The security log names three events more plainly: a sign-in from a new device, a session that was signed out and a backup that was downloaded.
- The privacy page of the return page now says that GitHub Pages is what sees the return request.
- The page and its cards are darker, so the app is easier on the eyes in the evening. Every text, chart and heat map colour is still checked against them: a test measures the contrast of each colour in the style sheet.
- A few colours moved a step to stay readable on the darker page: muted text, the green and red text, the ochre and grey chart series, the lightest heat map step and the chart axis line.
- The Finnish of the whole app was read through and about sixty texts were corrected: one name for one thing, plain verbs, and counts that read right for one. For example, the button that adds a bank now always reads "Yhdistä pankki", and "löydös" in the savings tips is "vinkki" everywhere.
- The sentences that the reports, savings tips and alerts build from parts were read through and over forty were corrected: one name for one thing ("vinkki", never "löydös"; "valmis kuukausi"; "annettu"), counts that read right for one ("Yksi epäonnistunut kirjautuminen"), and the example accounts are named "(esimerkki)" instead of "(demo)". Repo rule 28 keeps the calques and rejected words from coming back.
- Asetukset > Pankkiyhteydet no longer lists earlier connections. A connection whose accounts moved to a newer one, or that never had any, is not shown. A connection that has ended and still owns accounts stays in the list with Yhdistä uudelleen.
- The line in Asetukset > Palvelin that told what to do when the bank shows an error page at the end of the setup is gone. The Pankkiyhteydet page already asks for the address of that page when it is needed.

Maintenance

- *Asetukset > Ylläpito* has a switch, *Tarjoa uudet versiot heti*. A new version is normally offered two days after it comes out, and with the switch on it is offered at once. Nothing installs before you press *Päivitä*. Nobody needs to edit `.env` for this any more: the maintenance helper sets the line `TALOUS_PRERELEASE` and leaves the rest of the file as it was.
- The switch shows when the maintenance helper is in use. An install without the helper sets `TALOUS_PRERELEASE` in `.env` as before, and an install that follows the source code (`TALOUS_CHANNEL=source`) has no switch.
- The card *Palauta viimeisin varmuuskopio* in *Asetukset > Ylläpito* is now called *Palauta uusin varmuuskopio*, and a few of its sentences and the status *Peruutettu* read more plainly.

Upgrade

- The first start after the update sorts every row again, so categories, merchant names and card bills of past months change by themselves. Your own category choices stay, and your rules and marks follow a merchant to its new name. When several merchants get one name (every marketplace purchase becomes "Tori"), a rule made on one of them would reach all of them, so it becomes your own category choice on the rows it covered and the rule is removed. A mark on one of them does not carry over.
- Migration 0017 rebuilds the table of maintenance requests on the first start, after the usual copy. A rollback from this version puts back the copy from before the update.

## 0.9.0

- A damaged database no longer takes the app down: it starts on the newest intact copy. Under Asetukset > Ylläpito an admin can restore the newest copy, or start over, with one button each.
- An update that leaves the app not answering is taken back by itself, and the maintenance helper keeps a last good copy of itself, so Päivitä and Palauta edellinen versio work even after a broken update.
- A loan you saved can be linked to its connected card or loan account, and then it counts once in the debt total, in Saldot and in Säästövinkit.
- The app follows the server to a new home network address by itself, and a new release waits 48 hours before installs are offered it.
- The CSV import is gone. Bank connections are the way in, and accounts imported earlier stay.

Money and reports

- A saved loan linked to its connected card or loan account counts once: in the debt total of Lainat, in the accounts less the debts in Saldot and in the debt total of Säästövinkit. The balance is the one the bank tells, and the rate and the payments are those of the saved loan. The payoff date is counted from the bank's balance on the saved loan's due days, so it does not move from one day to the next.
- The link counts while the account's balance is at or below zero and is as new as the balance typed for the loan. With an account balance above zero, or one older than the typed balance, the saved loan counts with its typed balance, still once. In the months of Saldot before the linked account's first known balance the saved loan counts as typed.
- The warning that a debt may be in a total twice no longer names a linked loan or its account. It stays for a saved loan and an account that are not linked.
- The mortgage tips of Säästövinkit use the bank's balance for a saved mortgage linked to its loan account.
- The loan form in Asetukset > Lainat has the choice "Sama velka pankin tilillä", shown when the household has a card or loan account. A loan linked to an account counts once in the totals, with the bank's balance while the bank tells one and the balance typed in the form otherwise. An account that another loan holds is not offered. The loan list shows on a linked loan's row which account it is linked to.
- In the Lainat report the warning that a debt may be in the total twice ends with a link for each saved loan beside each of the household's own accounts. The link opens that loan's form with the account chosen, and once the loan is saved the warning is gone when the report is opened again. In the household view, where the account is a partner's, the warning still tells to remove the saved loan.

Fetching and importing

- The Tuo CSV card is gone from Asetukset, and the empty start pages offer the bank connection and the example data. The link `?section=csv` still opens Asetukset and scrolls nowhere.
- The notes under Tietojen laatu and the empty list of transactions no longer tell to import a file.

Reliability

- The three newest database copies that pass the integrity check are never deleted, whatever their age or name. A damaged copy does not count as one of the three, and neither does a `pre-restore-` copy, which a restore saved of the database it replaced. This holds in the app and in `scripts/update.sh`.
- No database copy is deleted while the live database fails its integrity check.
- A database copy is not started unless its disk has twice the size of the database and its WAL free. The error says how much is free and how much a copy needs. This holds for the daily copy, the copy before a migration and `scripts/backup.sh`.
- `scripts/update.sh` asks for three times the size of the database before it switches: its own copy, and the copy the new version takes before it changes the database. An update without that room stops while the old version still runs and names the data volume.
- A database copy that fails no longer removes an older copy of the same name. A copy is written under a temporary name and gets its own name only when it is complete and checked.
- The data volume holds a reserve file, `/data/.reserve`, of 64 MB. It is deleted when under 128 MB is free, so that a full disk still has room to sign in and free space, and written again once over 1 GB is free.
- A damaged database file no longer leaves the household without the app. When the server starts it checks the database, moves a damaged one to `data/damaged/banking-<time>.db` with its `-wal` and `-shm` files, and puts the newest intact copy from `data/backups` in its place. Nothing is deleted.
- Every admin gets a notice that names the copy and its time and says that changes made after it are lost. Asetukset > Turvallisuusloki has the event.
- With no intact copy, a damaged database that still opens stays in place: the app starts on it, the admins get a notice, and the line in the log names the restore instructions.
- When an intact copy exists and there is no room on the disk to put it in place, the notice says so: make room and restart, and the next start restores the copy.
- The check runs only when the server starts, never for a command such as `restore`, `migrate-check` or `version`. A database that is only busy or locked is left alone.
- An admin can take the newest intact database copy back from the browser, with no shell: the server side of "Palauta viimeisin". The request asks for the password again and the word PALAUTA, and it names no file: the server picks the copy, the same one a start after damage would take.
- The running app restores nothing itself. It notes the request in the data folder and stops, Docker starts it again, and the check before the start puts the copy in place. The database that was replaced is kept as `data/backups/pre-restore-<time>.db`.
- A restore is refused while an update or another maintenance request is under way, while a bank fetch or other background work runs, while an earlier restore waits for its start, and when no copy is intact. A refusal changes nothing on disk.
- The request is in the audit list of Asetukset > Ylläpito, and the other admins get a notice.
- A restore asked in the browser is carried out only by a start within 15 minutes of it. An older request is dropped, and the admins get a notice that the data is as it was. A requested restore that fails at the start is told the same way, and the audit list shows whether the restore was done.
- The notice after a requested restore names the admin who asked for it.
- A copy saved before the data was emptied (`pre-reset-<time>.db`) is restored only when an admin asks for it. A start after damage never takes it alone, and it is kept for 14 days however many copies follow.
- "Lataa uusin" hands out the copy a restore would take, never the database that a restore just replaced.
- A wrong confirmation word at "Tyhjennä kaikki tiedot" is now recorded in the security events, as it already was for a restore and a rollback.
- The weekly check of the database copies leaves a copy alone while its file has changed in the last two minutes and looks at it on the next round. A copy that was still being written or copied into the folder could be set aside as damaged.
- A restore of the database cannot be asked for while a reset of the data is still ending the bank connections, and a reset cannot be asked for while a restore waits for the restart. Both are refused with "Toinen toiminto on kesken."
- A rollback has one name on every page and in every notice: "Edellinen versio palautettiin", with the reason after it. The security log and the notice for an update the server took back no longer say "Ylläpitoapuri palautti päivityksen". The notice about a damaged database says in Finnish what to do next (free disk space and restart, or `./scripts/restore.sh` on the server) and calls a copy a "varmuuskopio".
- The app follows the server to a new home network address by itself. When the router gives the server another address, the maintenance helper notices that the old one has been gone for ten minutes, moves the app to the new address of the same network interface and starts it again, so it answers at the new address within a quarter of an hour. Before, someone had to run the installer again. The helper does this only on an install that listens on a home network address (no Cloudflare Tunnel, no own domain) and only for a private address (10.x, 172.16 to 172.31, 192.168.x), at most once an hour. If the app does not answer at the new address, the earlier settings are put back. The change is one line in `ops/helper.log`: `Osoite vaihtui: http://10.0.0.5:8080`.
- The maintenance helper frees Docker's disk before it runs out: when the disk has under 3 GB free, it removes this app's old, unused images, at most once in six hours, so the next update does not fail for lack of room. It takes only images that carry the app's own label. The running version, the previous version for a rollback, other software's images, the build cache and every volume stay, and nothing is done while an action or an install runs. The result is one line in `ops/helper.log`. The Siivoa button is unchanged.
- An update started from the page now tests the maintenance helper it brought. When the new helper cannot run, the update is taken back at once and the result says why, so a household is not left with an app that nobody can update from the page. The first update this guards is the one after 0.9.0.
- `./scripts/ops-helper.sh --self-test` runs the same test by hand. It prints `self-test ok` or `self-test failed: <reason>` and changes nothing.
- An update that leaves the app unhealthy is taken back with nobody at the keyboard. The maintenance helper looks at the app's container once a minute, always. When the app has been restarting, unhealthy by Docker's check or running without an answer for ten minutes in a row, and the update is less than one hour old, the helper restores the previous version with `./scripts/update.sh --rollback --yes` and reports it to the app. It does this once for an update, whatever follows. After the first hour it only looks: a rollback can put back the database copy from before the update, and what was entered since would leave the live database.
- The helper leaves the app alone when the container was stopped by hand, while an install, an update or a request runs, and when the app was already unhealthy before the update began. A rollback that does not bring the app back writes ops/RECOVERY.txt and is not tried again.
- The app's last log lines before such a rollback, and the rollback's output, are kept on the host for 30 days in ops/run/watchdog-<time of the update>.log. After a rollback to 0.8.x, which knows nothing of the report, the maintenance page shows it as one more line of the checks, until the next check runs.
- The maintenance helper's timer or cron line runs a small launcher that lives outside the Omatalous folder, in `~/.local/share/omatalous/<instance>/`, so an update never touches the file the timer runs. After a good run the launcher keeps a copy of the helper, once the helper has passed its self-test. When an update leaves a helper that is missing or does not even start, the launcher runs that last good copy, so Päivitä and Palauta edellinen still work from the browser. One line in `ops/helper.log` says when it does.
- The launcher refuses to run as root, and it runs no helper file that someone else owns or that others can write to.
- `./scripts/doctor.sh` tells whether the schedule runs the launcher, how old its last good copy of the helper is, and when the copy is running in place of the helper.
- `./scripts/install.sh --ops-helper-off` and `./scripts/reset.sh` remove the launcher's folder with the schedule.
- Once a week the newest database copy gets a full check (`integrity_check` and `foreign_key_check`), in an hourly run that did not write the daily copy. A copy that fails is renamed `<name>.damaged` and kept; it is no longer a copy to restore from, and it is not one of the three protected copies.
- An admin is told on the notice list when the safety net has a hole: no intact database copy in 36 hours, a copy that failed its weekly check, under 1 GB free on the data disk (or the reserve file given up), and a host helper that has not been heard of for 24 hours. Each notice says what to do and names Asetukset > Ylläpito.
- A notice about the safety net that an admin marks as read stays away while the problem lasts and comes back when the problem comes back. Each admin marks their own.

Maintenance

- An install follows the release GitHub marks as latest. A new release is a pre-release for its first 48 hours, and the daily check, the Päivitä button and `./scripts/update.sh` run by hand all leave it alone until it is promoted. `update.sh` used to take the newest git tag when run by hand, which a pre-release has from the start. A folder that is already on a pre-release (the key was on, or it was cloned in the first two days) stays there when `update.sh` is run by hand with the key off: it says so, changes nothing and does not build the source.
- `TALOUS_PRERELEASE=yes` in `.env` makes an install follow the newest release, a pre-release included, in the check, the button and `update.sh`. `no` or no line is the default. Any other value is refused: the helper does not run and `update.sh` stops, and the self-test names the key.
- When `update.sh` run by hand cannot ask GitHub which release is the latest, it stops with "Could not ask GitHub for the latest release. Nothing was changed." It no longer falls back to the newest tag. The same when GitHub says there is no release at all while the folder holds release tags: the daily check then fails too, instead of offering the source.
- A rollback renews the maintenance helper's schedule, as an update does, so the timer matches the version now running.
- A household can start over from the browser and keep the install. An admin gives the password and types `TYHJENNÄ`: every member, account, transaction, rule, mark, loan, expected bill, saving tip, bank key and bank connection is deleted, and so are the payee names the trade register did not know as a company. The admin's own account, the server's settings, the shared bank application and the trade register's answers about companies stay.
- The app first writes a checked copy of the database, `data/backups/pre-reset-<time>.db`, and keeps it for at least 14 days. When the copy cannot be made, nothing is deleted. Restoring that copy brings the rows back. It does not bring back the bank consents: those were ended at the bank, so each bank is connected again.
- The reset removes no database copy. Older copies in `data/backups`, a database in `data/damaged` and the host's archives still hold the household's data until they are pruned or deleted by hand.
- Every bank consent is ended at the bank before its key is deleted. A consent the bank does not end is counted in the answer and in Asetukset > Turvallisuusloki, and the reset goes on.
- Everyone is signed out, the admin too, and the admin signs in again with the same password. The reset is refused while a maintenance request runs, a bank fetch is in flight or a restore waits for the next start.
- `./scripts/reset.sh` is unchanged: it still removes the whole install.
- An update, install, restore or reset run by hand keeps every other maintenance action out until it has ended. The lock used to stop holding once the update had replaced `scripts/install.sh`, so the helper could change the address or prune images during the rest of that update.
- The helper's launcher keeps a helper as its last good copy only after that helper has passed `./scripts/ops-helper.sh --self-test`. A helper that fails the test leaves the earlier copy in place.
- `./scripts/install.sh` in a folder cloned by hand asks GitHub which release is out. During a release's first two days it installs the latest release and not the pre-release the clone is at. When GitHub cannot be asked it goes on and says the release could not be confirmed.
- A release image no longer keeps its registry tag after it is installed, so Siivoa and the helper's housekeeping free the images of old versions on a release-channel install too.
- The setup code for the first account now works for 24 hours. After that the setup page says the code has expired and names the command that gives a new one: `docker compose exec banking node dist/node.js setup-code`.
- A restart replaces an expired setup code and prints the new one in the log, the way it prints the first one.
- A `SETUP_CODE` set in `.env` does not expire.
- A second instance made with `./scripts/install.sh --new-instance NAME` starts on the release this clone is at and uses its signed release image, as the one-line install does. It used to take the head of the branch and build it from source. It never takes a newer tag. With no release tag at HEAD, or a release that is not on `origin/main`, it keeps the head of the branch, builds the source and says so in one line.
- A re-run of the installer, or `--reconfigure`, keeps `TALOUS_CHANNEL` and `TALOUS_PRERELEASE` in `.env`, so the release channel the install was on is not lost.
- Etäkäyttö: the Cloudflare API token cannot be removed while remote access is on, because turning remote access off takes the address out of Cloudflare with it. Turn remote access off first. Saving another token in its place works at any time.
- Etäkäyttö: how the last change ended (it failed, or the server took a new address back) is shown for 24 hours and then no more.
- Turning remote access off is called *ottaa pois käytöstä* everywhere: on the page, in the server's answers and in the security event (*Etäkäyttö otettu pois käytöstä*).
- A report the maintenance helper sends after the 30 minute timeout is stored without the tunnel token, the audience tag and the host name of the Access team, like a report that comes in time.
- Asetukset > Ylläpito has a card "Palauta viimeisin varmuuskopio" below the list of copies. It shows the newest intact copy with its time in large type, its file name and its size, and says that changes made after the copy are lost and that bank transactions are fetched again at the next fetch. The admin gives the password and types `PALAUTA`. The app then stops itself and Docker starts it again, and the card waits until the app answers. When it stays down the card says to run `docker compose up -d` in the install folder, and that a request older than 15 minutes is dropped. The card never says the restore was done: the notice after the start tells whether it was. A copy that a reset made first (`pre-reset-…`) is named as the one that undoes the reset. With no intact copy the card says so and has no button.
- Asetukset > Ylläpito ends with a danger card "Tyhjennä kaikki tiedot" for the reset. Before the click it says what goes (accounts, transactions, loans, rules and the other users), what stays (the admin's own account, the server's settings and the bank application), that a copy is made first, that the copies keep the data, that "Palauta viimeisin varmuuskopio" undoes the reset for under a day because it takes the newest copy, and that the bank connections are made again. The admin gives the password and types `TYHJENNÄ`. The button is off from the submit until the answer. After the answer the card shows the server's sentence, the name of the copy and how many bank connections the bank did not end, and links to the sign-in page. A refusal from the server is shown as the server worded it.

For developers

- `tools/ci/drills.sh` runs ten drills in real Docker on the install the upgrade rehearsal has just built: the startup gate on a damaged database, Palauta viimeisin through the API with the app restarting by itself, the watchdog's rollback (once, and not again), a next release whose helper fails its self-test, a full data volume, the reset followed by a restore, the installer's lock after an update that changes `install.sh`, the rollback over a database the previous version cannot read, the helper behind symbolic links, and the release parser against GitHub's real answer. Each prints one line, ok or failed with the reason, and a failed drill prints what it saw under it, within 30 lines. The release parser's drill reads skipped, which is no failure, when GitHub gives no answer. The script stops itself at 10 minutes (`DRILLS_LIMIT`).
- `upgrade.yml` runs the drills as one step on the first baseline's leg, after the rehearsal. The new input `drills_only` runs that one leg and the drills and skips the rest, for a short round while working; `upgrade-ok` stays red then, on purpose.
- `ops poll --dry --helper N` answers the host helper's question "do you answer me": it always prints `{"request":null}` and writes nothing, so no request is handed out or expired and the helper does not count as seen. The poll without `--dry` is unchanged.
- The helper's state may carry `watchdog: { at, from, to, reason }` for an update it took back by itself. Each new `at` becomes one `ops_watchdog` security event and a `watchdog_notice` to every admin; a report in any other shape is dropped.
- A release is created as a pre-release. `/releases/latest`, which installs read, skips it, so an install is offered a release 48 hours after it is made.
- `promote.yml` runs every six hours and by hand, in the public repository only. `tools/ci/promote-release.sh` promotes the highest release when it is a pre-release that is 48 hours old, above the latest release, and its image verifies with the check installs run. One release per run; the run ends green when there is nothing to do.
- A release is held by making it a draft (`gh release edit TAG --draft`) and pulled by deleting it. A draft is never promoted, and while the highest release is a draft nothing older is promoted either. Promoting early is `gh release edit TAG --prerelease=false --latest`.
- A release builds the amd64 and the arm64 image each on a runner of its own processor. The arm64 build no longer runs under emulation.
- A release starts both images before it tags or signs anything: as a new install and on a database of 0.5.0, which must migrate. A failed start leaves no tag, no signature and no release.
- The release workflow has a `dry_run` input that builds and smoke tests both images and publishes nothing.
- `tools/ci/smoke-image.sh IMAGE VERSION COMMIT` is that smoke test. CI's docker job runs it on every image it builds.
- Every workflow job runs on `ubuntu-24.04` or `ubuntu-24.04-arm`, and repo rule 23 refuses a `-latest` runner label.

Upgrade

- Updates now follow the release GitHub marks as latest. To get a release during its first two days, set TALOUS_PRERELEASE=yes in .env.
- Importing a CSV file is no longer possible. Accounts and rows imported earlier stay and work as before.
- The first start writes `/data/.reserve` (64 MB) when the data volume has over 1 GB free. A backup made with `scripts/backup.sh` does not include it.
- From the update after this one, `scripts/update.sh` needs three times the size of the database free in the data volume.
- A database the app found damaged at start is kept in the new folder `data/damaged`. The app never removes those files: delete them by hand when they are no longer needed.
- The maintenance helper's timer now runs a launcher under ~/.local/share/omatalous/<instance>/. Nothing to do.
- A copy that has no user yet, and no `SETUP_CODE` in `.env`, gets a new setup code at the first start, and the old code stops working. Get a code with `docker compose exec banking node dist/node.js setup-code`. Copies with a user are not affected.
- `./scripts/install.sh --new-instance NAME` now installs the release this clone is at, not the head of the branch.
- Migration 0016 adds the column `account_id` to `loans` on the first start, after the usual copy. It only adds a column and an index, so 0.8.0 or later still opens the database after a rollback and keeps the links.
- `cloudflare up`, which `./scripts/install.sh` runs for a Cloudflare Tunnel, checks the host name and the sign-in addresses the way the Etäkäyttö page does. An address the page would not take and a host such as `127.0.0.1` now stop it with exit 2.

## 0.8.7

- Loans: paste a screenshot or the text of a loan, drop a PDF or type the figures under Asetukset > Lainat, and the app reads the lender, what is owed, the rate and the payment into a form to check. The reports then count the debt and show the interest of the next 12 months.
- Sixteen more Finnish banks and card issuers can be connected besides Nordea, picked from a list with their logos, and each connection can be renewed with one button before it ends.
- Remote access is set up in the browser, under Asetukset > Palvelin > Etäkäyttö, with a Cloudflare API token, an address and the emails that may sign in. A new address that nobody gets in through is taken off again after 15 minutes.
- One pasted command installs Omatalous on a fresh Ubuntu machine, checks the script's hash first and asks its questions before it installs anything.
- A copy on the internet is harder to attack: the app checks Cloudflare Access's signature itself, a flood of made-up sign-ins cannot lock the household out, and a person's name is never sent to the trade register.

Money and reports

- The warning about a category that cost more than usual (Kuukausi) takes its amount and its usual level from the Menojen muutos report, so the two always say the same. It uses the report's months, leaves one-off purchases out of the usual level and warns only when the report shows the category as risen.
- In a month that has not ended the warning compares the same days of the usual months and reads "Tavallisesti tähän mennessä". It says nothing in the first week of a month. When an account's transactions end some days ago, the warning names the day its figures reach, for example "201 € 10.10. mennessä".
- The warning speaks of the same month as the report on every period: 3 kk and Vuosi show what Kuukausi shows for the running month. They used to show the last full month's warning, which now shows when that month is selected.
- A new subscription, a bill that grew or came twice, one large purchase and a loan payment no longer raise the warning. The report names those causes.
- A category that settles on a higher level is warned about in its first month only. A month that was as far above usual a year ago is a season and gets no warning.
- A mark on Laskut (Käytössä, Lopetettu) now belongs to one subscription. When a merchant charges for two services, marking one as ended leaves the other in the fixed costs, in the list of what is coming and in the forecast, and the warning about a charge after Lopetettu counts only that subscription's charges.
- A merchant with several subscriptions shows the price on each row and in each button, so it is clear which one is answered.
- Marks made in earlier versions still cover every subscription of their merchant. Such a row says so, and Kumoa on it removes the mark from all of them. Each can then be marked on its own.
- Yli jäi now counts credit drawn to an account, so it is what stayed on the accounts. A household that bought a car with a loan no longer sees a loss the size of the car when its accounts hardly moved. Borrowed money is still never income.
- Mihin tulot menivät tells how a month that took more than its income was paid for: Katettu luotolla, Katettu säästöistä and Tileiltä tai kortilta, each with its sum, and a strip over the bar shows where the money came from. The third names both, since the totals cannot tell money that was on an account from more owed on a credit card. The red line "Menoja enemmän kuin tuloja" is gone.
- When credit was drawn, the bridge shows it at once with the debt service of the period ("Luottoa nostettiin 20 000 €, velanhoitoon meni 1 200 €"). When no debt was paid in the period, it also says how much of the credit is in Yli jäi.
- The table of the bridge lists what came in and what went out, and the rows add up to Yli jäi.
- A period with no income, or one where refunds were larger than purchases, has no bar: it shows the table with Yli jäi and the sentence on how it was paid. Before, a period with no income showed only "Jaksolla ei ole tuloja".
- Nothing changes for a month in which the household borrowed nothing, drew no savings and lived within its income, with one exception: the rare month where refunds are larger than purchases now shows the table.
- Loans get a model of their own, for the debt a bank connection cannot show. One place works out what is owed on a day, the debt total, the interest of the next 12 months, the payoff date, how much of a credit line is in use and how a payment splits into interest and amortisation.
- A loan figure that needs a missing field, such as the rate, is left empty and says which field. Nothing is estimated.
- The server keeps the loans a user has confirmed, one list per user. Another member never sees or changes them, and sharing an account shares no loan.
- A loan is checked when it is saved: amounts and rates are whole numbers within a range, the balance date is not in the future, a card or a credit line has no repayment plan, a bullet loan has no payment, and a payment that holds the interest must cover it. A value outside its range is refused with a message that names the field.
- Core can read a loan from pasted text: `parseLoanText` takes text copied from a bank's loan page, the positive credit register's listing or a SECCI form, or OCR of a screenshot, and returns one draft per loan. Each field carries its value, the source line and `sure` or `check`. Nothing is saved from it yet; the page that shows the draft comes with the loan pages.
- A figure with no label is left out. A repaired OCR digit, a lost comma, a label over two lines or a failed cross-check (rate against reference plus margin, balance against the granted amount, payment against the annuity) gives `check`, never `sure`. So do a rate or a margin above 25 % and an amount of three digit groups with no unit and no cents (`5 000 200`).
- A value on the line below its label is `sure` only inside the run of labels and values that proves the page puts values below. A page that prints its main figures above their captions and a list of details under them no longer gets the wrong figure as `sure`.
- Where a word that can name another figure (`Korko`) and the register's own label (`Kokonaiskorko`) both give a value, the register's label has the field. A draft with a payment says whether it is the whole payment or the amortisation alone (`paymentKind`).
- Asetukset has a new card, Lainat. Paste a screenshot or the text of a loan into its box (Ctrl+V, or the phone's paste), drop or pick a picture or a PDF, or type. The app reads the lender, what is owed, the rate, the payment and the last due date into a form, one form per loan it finds. Lisää käsin opens an empty form.
- Each figure shows the line it was read from and a mark: Varma, Tarkista or Ei löytynyt. A Tarkista field is outlined, and Tallenna waits until it is ticked as right or corrected. Everything read from a picture is to check. Nothing is saved before Tallenna.
- The picture, the PDF and the text are read in the browser and sent nowhere. The picture reader with its Finnish and English data (about 11 MB) comes from the app itself the first time a picture arrives. In a phone-sized browser at a quarter of the processor speed, a screenshot of three loans took about four seconds.
- A read stops with Keskeytä, when a newer picture, file or text arrives, and by itself when it makes no progress for two minutes, with a sentence that says what to do next. A picture of over 40 million pixels is refused before it is opened, so a huge file cannot fill a phone's memory. A clipboard that holds a picture and text, as Word and Excel give, is read as the text.
- A status line tells a screen reader when a read ends and how many loans it found, focus moves to the first form, and a field's error is read with the field. After Tallenna or Hylkää the focus goes to the next form or back to the box.
- The licences of the software that reads pictures and PDFs are in THIRD-PARTY-LICENSES.txt, served with the app.
- The card lists the saved loans with name, lender, what is owed, rate, payment and end date, each with Muokkaa and Poista. A member sees only their own loans.
- A payment smaller than the interest of its interval is pointed out before saving, with a button that empties the payment for a loan on a payment holiday.
- A tip under the box says that one screenshot of the positive credit register's page brings every lender at once.
- More loan payments count as debt. A row that names OP or Pohjola finance, or Toyota or Volkswagen finance, is a loan payment, and so is a row with a word such as JOUSTOLUOTTO, AUTOLAINA or LUOTONLYHENNYS, which the earlier rule missed. A lease, a bond bought through a bank, a refund from a finance company and a housing company's charge for its own loan stay what they were.
- A purchase paid in parts through Klarna, Walley, Riverty or Anyday counts as debt when the row says it is an instalment. A purchase paid at once through them stays shopping, and so does a refund.
- Money a peer-lending service such as Mintos, Estateguru or Tessin Nordic pays back is the household's own money coming home, so it lowers what was saved and no longer shows as income. Money sent to such a service counts as saved. A row from such a service that names a loan or a credit is the household's own borrowing, as before.
- Behind the loans page: the app works out which monthly payments look like a loan nobody has saved. It takes three or more payments of at least 20 € about a month apart to one payee with one payment reference, still running. Rent, own transfers, card bills, a lease, an insurer's bill, a housing company's charge and subscriptions are never proposed, and neither is a series answered "Ei laina" or one a saved loan is linked to. "Ei laina" is an answer of its own, so marking the same payment on the bills page does not undo it. A proposal has the payee, the usual payment and the months seen. It has no balance and no rate.
- Raportit has a new Lainat section for a household that has saved a loan. It shows what is owed in all, the interest of the next 12 months and the payments a month, and for each loan the balance today, the rate, the next payment split into interest and amortisation, the interest of the next 12 months and the date of the last payment.
- A payment is never more than what is still owed with its interest. A loan that is paid has no payment and is not in the payments a month.
- A loan with a Euribor reference rate gets a line that tells its payment and the interest of the next 12 months if the reference rate falls or rises by one percentage point. The rate falls no lower than the loan's margin. A loan without a payment plan tells the interest alone.
- What the app does not know about a loan reads "ei tiedossa", never zero. A total that leaves loans out says how many.
- Lainat and Saldot show "Tilit miinus velat": the connected accounts less the saved loans today. It leaves out the value of a home and of investments, and says so.
- A saved loan cannot be tied to a connected account yet. When a connected card or loan account may be the same debt as a saved loan, both are counted. Lainat says that the debt may be in the total twice and that removing the saved loan fixes it, and Saldot and Säästövinkit point there. An account below zero beside a saved credit line may be one debt too: Lainat and Saldot say so beside "Tilit miinus velat", the one figure that would hold it twice.
- In the household view the saved loans are the viewer's own, and the section says so.
- Säästövinkit reads a saved mortgage instead of asking for the loan's margin again, uses the loan's own balance and rate, and shows the same debt total as the Lainat section. A saved fixed-rate mortgage is not asked for a margin.
- A household with no saved loans sees no change.
- New observation: what the interest on a connected credit card cost over the last 12 complete months, with the card and the number of months interest was charged in. It shows from 120 € and ranks by its sum like the other observations. A card paid in full every month is charged no interest and gets no observation.
- The interest is told once: on a period where the bank fees alert shows, the alert holds it and the observation stays out, and on Säästövinkit the card interest tip holds it.
- Asetukset > Tilit shows a thin bar under an account's credit limit line: how much of the limit is in use, in the warning colour when the balance is over the limit. An account without a limit, or with nothing owed, has no bar.
- Asetukset > Lainat shows the monthly payments that look like a loan nobody has saved, above the list of loans. Each row has the payee, the monthly sum, since when it has been paid, and the question "Onko tämä lainan maksu?" with two buttons. Tallenna lainaksi opens the loan form with the lender, the kind, the payment and a one-month interval filled in; the balance and the rate are left to you. After saving, the row is gone.
- Ei laina ends the question for that payment. The payee can be a bank, a finance company, a housing company or a private person, so the block says that a payment that is something else is an Ei laina. An answer can be changed by saving the loan by hand.
- Nothing is shown while there is nothing to ask, and there is no count or badge elsewhere in the app. The proposals are worked out for each request from your own rows, so a saved loan or an Ei laina takes effect at once. New route `GET /api/loans/proposals`.

Fetching and importing

- The app can now start a consent at 16 more Finnish banks, not only Nordea: OP, Danske Bank, S-Pankki, Säästöpankki, Oma Säästöpankki, POP Pankki, Aktia, Ålandsbanken, Bank Norwegian, Resurs Bank, Morrow Bank, Eurocard, Finnair Plus Mastercard, SAS EuroBonus Mastercard, Holvi and Revolut.
- The server offers a bank only when the household's own Enable Banking application lists it. It asks Enable Banking once a day. With no application yet, or when Enable Banking does not answer, the list is Nordea alone.
- The connection test in Asetukset > Palvelin passes when the application lists any bank the app knows, not only Nordea.
- After a bank is linked the server log gets one line per account with the bank, the account type code, whether a credit limit came and the balance type codes. It has no account number, name or amount.
- The bank picker in Asetukset > Pankkiyhteydet lists the banks the household's Enable Banking application offers. The bank used last is first, a bank without a logo shows its name on a plain plate, and a search field appears when there are more than eight banks. With no bank on the list the picker says so and points to the application in Asetukset > Palvelin.
- A line under the picker says that the rows of a bank other than Nordea are sorted by the bank's own codes, so the first month's categories need a look.
- The setup texts and the bank buttons in the wizard and on the empty start no longer name Nordea as the only bank.
- The bank list of the day before stays while Enable Banking is slow or fails, and an answer without a list counts as a failed call.
- The server log line written after a link shows a code only when it is four capital letters.
- The Enable Banking guide covers every bank: the steps once, and a section for the banks whose steps differ.
- Payments to Resurs that change from month to month are card bills, as with the other card issuers. A fixed instalment to Resurs stays a loan.
- Morrow Bank, the new name of Komplett Bank, is known as a card issuer.
- A bank connection now stores the bank's own code of each row, and the categories read it. Pay is salary when the bank says so, also from an employer the app knows as a shop or a hospital and with no word of pay in the text. Cash from an ATM or a shop's till is cash. A move between your own accounts is a transfer, or saving when the other account is not connected. Benefits and pensions stay benefits. Your own rules decide first, and a category you set yourself never changes.
- Rows fetched before this update get their code on the first start, from what the bank sent with them, and are sorted again. Rows from a file have no code.
- Optimoi compares fees with Nordea's price list only on Nordea's accounts. A card connected from another bank is left out.
- Money to or from a savings account at Bank Norwegian or Morrow Bank is saving. It was a card bill on the way out and borrowed money on the way in.
- Every connection under Asetukset > Pankkiyhteydet has the button Yhdistä uudelleen, also long before the consent ends. It starts the same bank at once, with no picker.
- The connections table says when a consent ends in words, for example "voimassa 14.1.2027 asti, vielä 93 päivää", in one column with the state.
- Muistutus kalenteriin under the end date downloads a calendar file with one all-day event seven days before the consent ends, "Omatalous: pankkiyhteys vanhenee 14.1.2027". The browser makes the file. It holds the bank's name, the end date and the address of Omatalous, and no account detail.
- After a link, the page lists the accounts the bank handed over that Enable Banking does not let Omatalous read, each by the bank's name for it and its last four digits, with the one step that fixes it: link them under Link accounts in the Control Panel, then press Hae nyt. The page looks again for a minute after a link, so the list appears when the first fetch has run, and a fetch that works takes an account off it.
- After a link the button Lisää pankkiyhteys reads Yhdistä toinen pankki, so a household with two banks, or one that adds Nordea an account at a time, goes on without starting over.
- A member's test of their own Enable Banking key is counted per member before the key is read: eight tests in a window of ten minutes that starts with the member's first test. The ninth is refused with a Finnish message before anything is sent to Enable Banking, and the first refusal of a window is written to the security log as a lockout. The administrator's test of the shared application counts one window for the whole instance with the same figures.
- The Enable Banking guide covers renewing, the calendar file and the list of accounts that are not linked.

Look

- The bank picker and the list of bank connections show each bank's logo. A bank whose logo cannot be fetched keeps its name on the plate.
- The server fetches the logos from Enable Banking's website and serves them from your own address, so your browser still calls no third party.
- Tapahtumat on a phone lists the rows under day headers, newest first. Each row shows the merchant, the category and the amount on two lines, and the category can still be changed in place.
- On a phone the filters are behind one button, Rajaa, which shows how many are on. The search field stays in view, and the rows start on the first screen.
- On a phone the answer to a category change appears at the bottom of the screen, where the row is, instead of at the top of the list.

Reliability

- A name is no longer looked up in the trade register when a word of it has a digit glued on (Meikäläinen2 Matti) or holds a character nobody sees, such as the soft hyphen of a copied page. A shop named so with no company form (Kioski24 Esimerkki) gets no category from the register: set it by hand or with a rule.
- A MobilePay payment counts as one between people by the same rule of a name's shape. A name with an initial or a comma (Laine, Helen J.) is a person's also when one word of it is a brand. SE, SA and AS at the end of a name no longer make it a company's, so a MobilePay payment to "Zalando SE" lands in Maksut henkilöille: set its category by hand or with a rule.
- The loan pages and the messages the server gives for a loan use one word for each thing: jäljellä, maksuerä, viimeinen eräpäivä, laji, luottolimiitti and kokonaiskorko.
- The loan form no longer asks for Ctrl+V on a phone.
- Saldot and Optimoi say "Sama velka voi olla summassa kahdesti" in the same words as the Lainat report.
- When an update changes a merchant's name, an answer "Ei laina" to a proposed loan and a saved loan's link to its payments follow the new name. Earlier the question could come back and the loan lose its payments.
- The lead of the spending change report names the day its figures are cut at ("Lokakuu on 10.10. mennessä 176 € tavallista kalliimpi") when a card's rows end before today, as the spike alert already did. It no longer says "tähän asti" for a day that is not today.
- The Tämä kuu line on the overview names the credit drawn last month (luotonnostot) beside the savings rate, when there was some.
- Säästövinkit > Luottokortin korot counts a card's interest the way the card interest insight does, so both tell one sum. Interest the bank took back is taken off, and an interest row sorted under bank fees is counted. The sum can differ from before by those rows.
- The insight "Luottokortin korot maksoivat ..." was hidden whenever the bank fees alert showed, also when that alert was about other charges. It is now hidden only when over half of its interest rows are in the period the alert sums.
- The same insight no longer links to the transaction list. The list showed other interest too and did not add up to the figure.
- The instalments insight ("osamaksuja ... kuussa") leaves a connected card's interest out of "korkoja ja luottokuluja". The card interest insight tells it, so it is told once.
- Asetukset > Tilit says in words when a card or a credit line is over its limit, for example "yli luottorajan 200 €". Before, only the colour of the bar told it, and a screen reader did not read the bar.
- A person's name is no longer sent to the trade register. Earlier versions could send one: the name of a person paid twice by a transfer the bank delivers without a payee account, or paid through MobilePay or PayPal on a card. Only the name went, never an amount or an account number.
- A name is looked up only when its rows say it is a business: a card purchase, an e-invoice or a direct payment, or a company form (Oy, Tmi, ry) in the name. A name shaped like a first name and a surname is never looked up, whatever the row says, and neither is the name of a way to pay (Siirto, Maksu, Verkkopankki).
- An invoice paid with a reference number is looked up when the payee's name has a word such as kauppa, liike or kerho and at most one name on either side of that word. A reference number alone is not enough: a private landlord gives one too.
- Fewer shops get a category from the register: a shop named like a person, and a shop paid through MobilePay or PayPal whose name has no company form and no word such as kauppa, liike or palvelu. Set the category by hand or with a rule.
- A company whose name begins with its company form ("AB ESIMERKKI") and is paid by a plain transfer is not looked up either: the name has the shape of two initials and a surname.
- After the update a row can lose a category that came from the register, where the row no longer counts as a payment to a business.
- The update removes the stored register answers of names that are no longer looked up.
- A copy behind a Cloudflare Tunnel can check Cloudflare Access itself. With `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` in `.env`, every request must carry the token Access signs for that copy, or it gets 403. A deleted Access application, a Bypass policy or a second host name on the tunnel then no longer shows the app's login page to anyone.
- The installer writes both values when Cloudflare makes the tunnel (`cloudflare up` returns them), and removes them with `--cloudflare-down` or when the copy gets another way in. With the check on, the app's port on the machine itself answers 403 too; only `GET /api/health` is open.
- The app refuses to start when only one of the two values is set, or when either has the wrong form.
- A flood of sign-in attempts with made-up user names can no longer keep the household from signing in. When a sign-in limit is full, an address someone signed in from in the last 30 days is counted in a spare of its own, under the same limits. The app remembers at most 100 such addresses, in memory only.
- `./scripts/install.sh --cloudflare-down` removes the Access rule only after nothing in Cloudflare leads to the address any more. When the copy's tunnel also routes another host name, or the address has a DNS record that points somewhere else, the command leaves that as it is, keeps the Access rule, says in one line what is still there, and stops with an error. `.env` stays as it was. Remove what the line names in the Cloudflare dashboard and run the command again. Before, the Access rule went all the same, the command reported success, and the copy could answer at its address with only its own login in front.
- `cloudflare down` exits 3 in that case. It also leaves a tunnel of the same name that has no route for the address: `a-b.example.fi` and `a.b.example.fi` share a tunnel name.
- The daily backup copy to a NAS no longer writes through a link someone placed on the share. The write test uses a new random name, a link at the temporary name is replaced, and a link at a file's final name stops the copy with a warning.
- `restore.sh --secret` tries the secret file on the restored database before it replaces the app secret. A wrong file, such as another copy's secret, is refused and the current secret stays. A database with no saved bank keys takes any secret, as before.

Maintenance

- A new install is one pasted command. It downloads a small script, checks the script's sha256 against the one in the command and runs it only when they match. The script puts Omatalous in `~/omatalous` at the newest release, and only when that release is part of the `main` branch, then starts the installer. A second copy: add `--new-instance NAME`.
- The install script and its hash are published with the return page. Publishing stops when the script, its hash file or the hash in the README and the install guide disagree.
- The server can now put its own copy behind Cloudflare for Asetukset > Palvelin > Etäkäyttö: an admin saves a Cloudflare API token, picks an address and lists the email addresses that may sign in, and the app makes the tunnel, the DNS record and the Access login in Cloudflare. No shell on the server is needed.
- Every change asks for the admin's password, removing the API token included. The API token is checked against Cloudflare before it is saved, is kept encrypted and is never shown again. It cannot be removed while a change is still under way.
- A new remote address is on trial for 15 minutes. The first visit that comes in through the Cloudflare login keeps it. If nobody gets in, for example because of a mistyped email address, the server turns remote access off by itself, removes the Cloudflare side and says so in the page and in the security events. The home address works again without anyone opening a shell.
- An address that could not work is refused before anything changes: a domain that is not yet active in Cloudflare, and an address with more than one part in front of the domain. The message shows the form to use.
- The same place changes who may sign in and turns remote access off. Turning it off first takes the server out of the tunnel and only then removes the Cloudflare side. If something else in Cloudflare still leads to the address, the Access login is left in place and the app says so.
- Before remote access is turned off the app tells where it will answer afterwards. When that is the server itself only (localhost), turning off asks for a separate yes.
- An address that is already in use in Cloudflare and was not made by this copy is refused, the same way `./scripts/install.sh` refuses it. Remote access that the installer set up on the server is left to the installer, and the app says so.
- When Cloudflare refuses something the app tells which kind of problem it is in Finnish: a token that is not accepted, a missing permission, Zero Trust not turned on, an address that is taken, an address outside the token's domains, or no connection.
- The security events list shows when remote access was turned on or off, when the server took it off by itself, when a change failed and when the API token was saved or removed.
- `secret rotate` re-encrypts the saved API token with the new secret. When the token cannot be opened, the message names it and tells to remove it in Asetukset > Palvelin > Etäkäyttö and run the rotation again.
- Security: a copy that is put behind Cloudflare from the app answers on its port from the server itself only (`BIND_ADDRESS=127.0.0.1`), as a tunnel install made by the installer does. Cloudflare's connector reaches the app inside Docker and never needs that port, so no other device on the home network can reach the app past Cloudflare Access or tell it which address a visitor comes from.
- Turning remote access off puts the earlier home network address back. The helper keeps it in `.env` as `ACCESS_LAN_BIND` while the tunnel is on, and a later change of the tunnel does not lose it.
- The helper's report now tells where the copy would answer once remote access is off, in every mode (`lanAddress` of its state). This lets the app warn an admin before a copy that answers on the server itself only is taken out of the tunnel.
- The helper on the server can now change how the copy is reached: Cloudflare Tunnel with Access, or the home network again. This is its tenth action, `access` (etäkäyttö), and it asks for the admin's password, like an update. The page that asks for it is Asetukset > Palvelin > Etäkäyttö.
- The helper checks every value itself before it writes anything, rewrites `.env` in one step with mode 600, starts the containers again and waits for the app to answer. When the app does not answer, it puts the old `.env` back and says so in the result.
- The old `.env` of the last change stays on the server as `ops/env.prev` (mode 600), one generation. The helper puts it back only over the file it wrote itself: a `.env` edited by hand in between is left as it is, and the result says where the old settings are.
- An address is not accepted as the hostname: the last part of the name must hold a letter.
- The tunnel token is never on a command line, in the helper's journal, in `helper.log` or in the result. The result names only the new address. A half-written `.env.new` left by a helper that was killed is removed at its next run, and git ignores that file.
- A copy with its own domain (Caddy) is refused: the helper changes nothing there.
- Fixed: a helper killed in the middle of a restart, with the app down at its next run, went back to the previous version of the app. Now only an update or a rollback cut short does that. A restart cut short starts the containers again, and a remote access change cut short starts them, waits for the app and puts the old `.env` back when the app does not answer.
- Fixed: the helper never reported the copy's address, because the pattern that checked it matched nothing. The update panel now shows the address beside the version.
- Asetukset > Palvelin has a new part, Etäkäyttö, for the admin. It shows whether remote access is on, the address and who may sign in, and it turns remote access on, changes the allowed email addresses and turns it off, with no shell on the server.
- Turning on starts by saving Cloudflare's API token, with a short guide in Finnish for making it, the permissions it needs, the domain being active in Cloudflare and Zero Trust being on. The token is typed once, asks for the admin's password and is never shown again; the page shows only that it is saved and which domains it sees. Removing the token asks for the password too, and is not offered while a change or a removal from Cloudflare waits.
- Before remote access is turned on, and before the list of allowed emails changes while it is on, the page shows the address and every email back and asks for a yes. It says that the home network address stops answering once remote access is on. A page that was open at the home address then points to the remote address instead of going blank.
- A new address is on trial. It has to be opened once through Cloudflare's sign-in before the clock time the page shows, otherwise the server turns remote access off by itself. The page then says that this happened, for which address, and what to check (the email addresses and the domain's DNS in Cloudflare).
- Before the off button the page shows the address where the app is found afterwards, and says that a browser that came in through the remote address loses the app. When the copy would answer on the server machine alone, the page says so and takes remote access off only after an explicit choice. The server's own refusals are shown as they come.
- A change that waits for the maintenance helper is shown as waiting and can be withdrawn while it is queued. The page reads the state again every few seconds until the helper has done it, then shows remote access on or the helper's reason for failing.
- An address made by the server's installer cannot be changed from the page, which says so and offers only the off. If something else in Cloudflare still leads to an address, or the installer made it, the page shows the server's reason and the Access login stays.
- With no maintenance helper, or one too old for this, the page says so, shows the command that enables it and links to the guide for the installer route.
- Security: a sign-in list for remote access that leaves out the address the admin is signed in with through Cloudflare Access is refused, and the answer names the address. A change of the list behind an address in use has no trial, so such a list locked the admin out at once.
- Turning remote access off through the tunnel now waits for the helper's next report when the last one is from before a turning on that was cut short. Cloudflare's side was removed at once in that case, which left a copy nobody could reach.
- A server that starts again in the middle of the 15 minute trial of a new address takes an unproven address off when the 15 minutes are up. It could take up to 15 minutes longer than the page said.
- The host name of the Access team is removed from what the helper reports about a remote access change, as the tunnel token and the audience tag already were.
- The installer writes the Access pair and the tunnel token to `.env` in one step, and takes the pair off with the host in one step. A run that stopped in between could leave half a pair, which the app refuses to start with.
- Remote access takes up to 50 sign-in addresses in the app, as the installer does. The app stopped at 20.
- A remote access change that the maintenance queue would refuse (no helper, an old helper, another action under way, too many requests) is refused in the same words as on the maintenance page, and the hour's limit is now asked before anything changes in Cloudflare.
- The installer asks everything first (Docker's install, the docker group, the name, how the app is reached, the address, the port) and then installs Docker and builds without waiting for an answer.
- On Ubuntu 26.04.1, which has neither `sg` nor `newgrp`, the installer carries on in a new session through `sudo` after it adds your user to the docker group. If no way works it says to close the SSH connection and open it again, then run the script again. The update and doctor scripts say the same.
- Cloudflare Tunnel as the access choice: without a Cloudflare settings file the installer offers to run `./scripts/cloudflare-setup.sh` itself, and shows where Cloudflare's token is made and which permissions it needs. A refusal or a failure leaves the tunnel token question as before.
- The setup link at the end is also printed as a QR code when `qrencode` is installed (`sudo apt install qrencode`; the installer never installs it).
- An install from a checkout that sits on a release tag (the one-line install) takes that release instead of the newest tag, so a pre-release tag no longer makes it build from source.
- The maintenance helper accepts a pinned tunnel image: `cloudflare/cloudflared:<release>`, such as `2026.9.1`, with or without a `@sha256:` digest. The image is still `cloudflare/cloudflared:latest` in this release. A later release can pin it, and installs that have this version can then update to it from Asetukset > Ylläpito.

Upgrade

- Migration 0015 adds the column `bank_txn_code` to `transactions` on the first start, after the usual copy. It only adds a column, so 0.8.0 or later still opens the database after a rollback and keeps the codes. The first start then reads the codes of older fetched rows from the stored bank data and sorts those rows again. Some categories of older rows change with it.
- New `.env` key `ACCESS_LAN_BIND`, written and removed by the maintenance helper. A copy whose tunnel the installer made has none: it stays on `127.0.0.1` when remote access goes off, and the helper's report says so beforehand.
- The host helper is version 3. It runs from the copy's folder, so it is version 3 from its first run after the update and nothing needs installing. Until that run the app refuses the remote access change.
- Migration 0014 adds the table `loans` on the first start, after the usual copy. It only adds a table, so 0.8.0 or later still opens the database after a rollback and keeps the loans saved since the update.
- The Content-Security-Policy has `'wasm-unsafe-eval'` in `script-src`, which the picture reader needs. The web files grow from 0.7 MB to 17 MB, because the reader and its language data come with the app; a browser fetches about 11 MB of them, once, when the first picture is read.
- The app's own check of Cloudflare Access is off until `.env` has both values. Where the installer made the tunnel, run `./scripts/install.sh --access tunnel` once after the update. For a tunnel made by hand, add `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` to `.env` yourself (`.env.example` says where to find them) and run `docker compose up -d`.
- If you ran `--cloudflare-down` on 0.8.6 for a copy whose tunnel had a second host name, or whose address had a DNS record you made yourself, look in the Cloudflare dashboard: a tunnel or a record may still lead to the address, with no Access rule in front of it. Remove what is left there.

## 0.8.6

Highlights

- A copy can be reached from anywhere behind Cloudflare Access, set up by the installer: the tunnel, the address and
  the email login are made for you (Cloudflare's free Zero Trust plan). Each copy has its own allowed addresses.
- The figures agree across pages: own transfers no longer swell the sums, a merchant costs the same on every page,
  and Säästövinkit tells each euro once.
- Connecting the bank takes fewer clicks. Backups can run on a schedule, encrypted, and copy themselves to a NAS; a
  restore is one command.
- Logins hold against a client that keeps changing its address, for copies on the internet.

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
