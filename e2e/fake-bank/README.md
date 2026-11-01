# The fake bank

A stand-in for the bank's API (Enable Banking) for the browser specs: plain Node, no dependency, 127.0.0.1 only. It
answers the paths `connectors/enable-banking/client.ts` calls and checks for a bearer token, nothing more.
`pnpm e2e` starts it beside the app (`e2e/server.mjs`); `linkFakeBank(page)` in `e2e/helpers.ts` links it. By hand:
`node e2e/fake-bank/server.mjs` prints its address and consent host; start the app with `EB_API_URL=<address>
EB_AUTH_HOSTS=<host>` (loopback only), save any App ID and key as your own, pick Nordea, and open the consent path on its address.
The household, the same rows for a day (seeded, 14 months): MEIKALAINEN MATTI with checking (pay from ESIMERKKI OY) and savings;
MEIKALAINEN MATTI;KORHONEN ELISA with a joint account (600,00 from him on the 1st, 400,00 from her on the 2nd, LAINAN LYHENNYS
to ESIMERKKIPANKKI OYJ, the groceries); an ESIMERKKIPANKKI card with a 3 000,00 limit, a debt and a bill paid from his checking.
The consent path with `?own=1` links the same household under other account ids and with a joint account of its own
(`linkFakeBank(page, { own: true })`): the server keeps the closed months of a joint account for whoever links it next.
Each household also tells what its accounts opened with (`openings`): a balance is that plus the rows, and `apps/server/test/balances-match-rows.test.ts` holds every household to it, to the cent.
Not copied into the Docker image.
The bank list has OP beside Nordea; its consent brings one account (`OP-tili`, no rows). `PUT /fake/valid-days {"days":5}` makes the sessions that follow end in that many days (a consent about to end), `{"days":null}` takes it back; a spec that sets it takes it back.
`GET /fake/balance-calls` answers how many balance reads the app has made, for a spec that must show a page opened with no call to the bank.
`PUT /fake/auth-answer {"mode":"refuse-redirect"|"fail"|"ok"}` changes how the next authorisations are answered (a refused redirect URL, a failure; default `ok`); a spec that sets it sets `ok` again.
The consent path with `?evening=1` links the household of the First evening check (`first-evening.mjs`): VIRTANEN VEERA with checking, savings and a credit card, a year of rows, each with the category a reader expects. `GET /fake/evening-expected` lists those rows with their expected category. `pnpm first-evening` starts an empty install, links that household and checks that at least 95 % of the rows' value lands in its expected category; it is a local check and runs neither in `pnpm e2e` nor in CI.
The consent path with `?second=1` (OP only) links a second household at a second bank (`second-household.mjs`): LEHTONEN PEKKA with a checking account, a savings account and a credit card, eight months of rows in OP's dialect (the message in `remittance_information` with a separate reference number, card rows with the shop in the text and no payee, reserved `PDNG` rows with no entry reference). `GET /fake/second-expected` lists the booked rows with their expected category and the reserved rows. `e2e/second-household.spec.ts` links it beside the first household and checks sync, classification, isolation and that the first household's whole answers do not move.
