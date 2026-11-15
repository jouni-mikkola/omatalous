# Bank connection notes

Notes for a developer on how the Enable Banking connection behaves. The guide for a household is
[Connecting a bank](ENABLE_BANKING.md). The code is in `apps/server/src/connectors/enable-banking/`.

## The two links

A household registers its own Enable Banking app, which runs in restricted mode: the API returns only the accounts
linked to the app in the Control Panel and strips every other account from the answer. So there are two links. The
account link in the Control Panel is the list the app may read. The connection in Omatalous is the consent the app
fetches with. It lasts 180 days or the bank's own maximum when that is shorter. Enable Banking's documentation does not
say whether a link in the Control Panel expires.

After a link the server log has one line per account, `bank link <bank id>: cash_account_type=... credit_limit=...
balance_types=...`, with codes and yes or no only.

## Account fields

The bank's `product` becomes the account's name and `name`, which holds the holders, a line under it.
`cash_account_type` gives the type. Nordea sends `CACC` for every account, so a product with a savings word reads as a
savings account. With no code the product and description decide, never the holders' names. Every new consent works
the type out again unless the member changed it. A card's masked number (`CPAN`) shows as its last four digits and
`credit_limit` as its limit.

## How far back the history goes

The first fetch of an account, in `connector.ts`:

1. The longest history (`strategy=longest`) from `HISTORY_DAYS` ago, 730 days unless the stored setting says otherwise.
2. If the bank answers 400 or 422, the same account from 360 days ago, then from 89 days ago.

Later fetches start ten days before the newest row.

The backfill asks for more. A fetch the member starts (*Hae nyt*, or the fetch after a link) asks for the days before
the oldest booked row, in windows of at most 12 months, back to five years (`BACKFILL_REACH_DAYS`) and at most six
windows. A refused window is asked again within 360 days, then within 89 days, and the walk stops there. It runs once
a month for an account, and always right after a new consent. A fetch in the background never runs it. The days asked
for are recorded in `account_history` (`asked_from`, `source`, `first_row_day`), so the next walk starts where the last
one ended. Each call is noted in `account_fetch` with its trigger.

On the home network the member's address is a private one, and Omatalous never sends a private address as
`Psu-Ip-Address` (`psu.ts`). With no Psu headers the bank treats the fetch as unattended, which it may limit to four a
day for an account. Such a fetch is noted `manual-bare` and a backfill window `backfill-bare`, and `bank-limit.ts`
counts them with the scheduled fetches. With the default two sync hours that leaves one backfill window a day for each
account, and the fetch right after a link does not walk. A member who opens the install from a public address sends
the headers, and the backfill is not counted.

Seen in testing in October 2026. It is what the banks answered then, not a rule of theirs:

- A Nordea current or savings account gave about 18 months.
- A Nordea card refused a request of 730 days with 400 on the first consent, which is why the first fetch steps down.
  After a new consent it gave about a month.
- S-Pankki answered a request of 730 days in full.
- Enable Banking's page for Finland said that the Aktia Finnair Visa credit card cannot be read (checked 2026-10-12).

The history figure of `GET /api/admin/bank-app/capabilities` is the oldest row any fetch brought, not the bank's limit.

## Private return names

Enable Banking accepts a private https name as the redirect URL. Tested on 31 October 2026 in sandbox and in
production with a restricted app:

- The Control Panel accepted `https://koti.home.arpa/`, a `.lan` name and a private IP address as redirect URLs.
- `POST /auth` with a registered `redirect_url` returned 200 and an authorisation link. One that is not on the list
  returned 400 `REDIRECT_URI_NOT_ALLOWED`. The match is exact.
- After the bank login the browser was sent to the private name with `state` and `code` in the address. Enable Banking
  never fetched the address itself, so it needs to resolve only in the home.
- End to end through the app, with `APP_BASE_URL` set to the private name behind an https proxy with its own
  certificate: the bank login came back through `/api/connections/callback` and the connection was made.
- Not tested: a bank login in production with a plain IP address, and banks other than Nordea.

Production accepts only https. The public pages say no more than "URLs whitelisted for redirecting of end users":
[Control Panel](https://enablebanking.com/docs/api/control-panel/),
[API reference](https://enablebanking.com/docs/api/reference/), [FAQ](https://enablebanking.com/docs/faq/).

## Payment rules watch

Last reviewed: 2026-10-30

A rule that applies to the app gets an issue ([ROADMAP.md](ROADMAP.md)); a rule only proposed gets a line here. The review
is repeated at least every 6 months, and `pnpm check` fails when the date above is older (repo rule 44).
Sources opened for this review: the European Parliament's Legislative Observatory pages of the three files, the
Commission's texts through the Publications Office (EUR-Lex), and the EBA's page on payment services. The Council's own
pages refused the request, so the Council's position is not confirmed here.

| Act | Status on 2026-10-30 | Dates | In force |
|---|---|---|---|
| PSD2, [Directive (EU) 2015/2366](https://eur-lex.europa.eu/eli/dir/2015/2366/oj) | Law today | Applies since 13 January 2018 | Yes |
| [Delegated Regulation (EU) 2022/2360](https://eur-lex.europa.eu/eli/reg_del/2022/2360/oj), amending the SCA technical standards | Law today | Adopted 3 August 2022, applies from 25 July 2023 | Yes |
| PSR, [COM(2023)0367](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52023PC0367), file [2023/0210(COD)](https://oeil.secure.europarl.europa.eu/oeil/en/procedure-file?reference=2023/0210(COD)) | Text agreed in early second reading negotiations; the Observatory still says "Awaiting Council's 1st reading position" | Proposed 28 June 2023; Parliament first reading 23 April 2024; ECON approved the agreed text 5 May 2026; plenary indicative 14 December 2026 | No |
| PSD3, [COM(2023)0366](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52023PC0366), file [2023/0209(COD)](https://oeil.secure.europarl.europa.eu/oeil/en/procedure-file?reference=2023/0209(COD)) | Same stage as the PSR | Same dates as the PSR | No |
| FiDA, [COM(2023)0360](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52023PC0360), file [2023/0205(COD)](https://oeil.secure.europarl.europa.eu/oeil/en/procedure-file?reference=2023/0205(COD)) | Parliament's committee mandate only; the Observatory says "Awaiting Parliament's position in 1st reading" | Proposed 28 June 2023; ECON report 30 April 2024; negotiations confirmed by plenary 18 December 2024 | No |

The EBA's page on [payment services](https://www.eba.europa.eu/regulation-and-policy/payment-services-and-electronic-money)
treats the PSD2 rules as the ones that hold until PSD3 and the PSR apply.

What each means for Omatalous (the PSR and FiDA points are from the Commission's proposals, not the agreed text, which was
not opened):

- Consent length. Today Regulation 2022/2360 raised the repeat of strong customer authentication (SCA) for account
  information from 90 to 180 days. A consent of 180 days or the bank's own maximum (see
  [The two links](#the-two-links)) fits it, so the app needs no change. Under the PSR proposal the bank asks
  for SCA only at the first access, and the account information provider applies its own SCA when the household reads data it holds
  180 days or more after the last SCA. That could move the renewal from the bank's login to the provider's own step, via Enable Banking.
- SCA. The bank's login stays the SCA step on a new or renewed consent, and Omatalous never sees the credentials.
- Account information interfaces. The PSR proposal requires each bank to offer a dedicated interface for open banking
  data access, drops the duty to keep a fallback interface, and sets quarterly availability statistics and a test
  facility. That is the banks' and Enable Banking's work; the app meets the interface only through Enable Banking's API.
- Permission dashboards. The PSR proposal makes each bank show the household the access permissions it has granted. The
  consent list of *Asetukset > Pankit ja tilit > Pankkiyhteydet* stays the app's own view of its consents.
- FiDA. The proposal opens customer data beyond payment accounts (savings, loans, insurance and similar) to
  permission-based sharing, with data sharing schemes and permission dashboards. It reaches the app only if Enable
  Banking offers that data. Application is 24 months after entry into force in the proposal (18 for some articles).
- Enable Banking's role. It is the account information service provider the app connects through, so a change in the
  rules for such providers (interface, dashboard, SCA) reaches the app as a change in Enable Banking's API or terms.
- Timing. The PSR proposal applies 18 months after entry into force, which follows publication in the Official Journal.
  That has not happened. Final dates and any change to the points above are open.

No rule of the three new acts is in force, and the two that are (PSD2 and 2022/2360) need no change in the app, so
this review adds no step. When the PSR or PSD3 is published in the Official Journal, or the FiDA is agreed, the next
review adds a step to the Later list of the roadmap for each rule that needs a change.
