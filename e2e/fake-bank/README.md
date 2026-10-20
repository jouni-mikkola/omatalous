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
Not copied into the Docker image.
`PUT /fake/auth-answer {"mode":"refuse-redirect"|"fail"|"ok"}` changes how the next authorisations are answered (a refused redirect URL, a failure; default `ok`); a spec that sets it sets `ok` again.
