# Connecting Nordea (Enable Banking)

Enable Banking is the service that lets Omatalous read your Nordea accounts. It is free when you read only your own
accounts. You register one Enable Banking app for the household, which takes about 15 minutes:

1. Create a key in Omatalous and download its certificate.
2. Register the app at enablebanking.com with that certificate.
3. Link your Nordea accounts to the app there.
4. Save the app's Application ID in Omatalous.
5. Connect the accounts in Omatalous.

You log in with Nordea ID twice, in step 3 at Enable Banking and in step 5 in Omatalous. That is expected. You always
log in on Nordea's own page, and Omatalous can only read transactions and balances.

The setup checklist that Omatalous shows after you create your user follows the same steps. Later you find them under
*Asetukset > Palvelin*. Do steps 1 to 4 on the same computer, so the file you download in step 1 is at hand in step 2.

## 1. Create the key

On the checklist press *Luo avain* and then *Lataa varmenne (.crt)*. You get the file `talous-enablebanking.crt`. The
private key stays in Omatalous, encrypted.

Copy the redirect URL the app shows next to *Kopioi*. For a normal install it is
`https://jouni-mikkola.github.io/omatalous/callback/`.

## 2. Register the app

Sign up at <https://enablebanking.com>, open the Control Panel and choose *API applications > Add a new application*.

![Add a new application](images/eb-1-register.png)

1. Environment: *Production*.
2. Private key: *Generate outside the browser and import public certificate*. Choose the `.crt` file from step 1.
3. Redirect URLs: the URL you copied in step 1, exactly.
4. Application name: `Omatalous`. Description: anything, for example `Personal budgeting`. Email, privacy URL and terms
   URL are not checked. Use your own email address. Any web address works for both URLs, for example
   `https://github.com/jouni-mikkola/omatalous`.

Press *Register*.

## 3. Link your accounts

The new app is *Inactive*. Press *Activate by linking accounts*.

![Activate by linking accounts](images/eb-2-activate.png)

Choose Finland, Nordea and Personal, press *Link* and log in with Nordea ID.

![Link](images/eb-3-link.png)

On Nordea's page you pick one account at a time. Pick one and press *Jatka*.

![Pick one account](images/eb-4-choose-account.png)

The app is now *Active*. Press *Link accounts* again for each other account and credit card you want in Omatalous.
Omatalous can read only the accounts listed under *Linked accounts*. Link all of them here before you go on.

![Linked accounts](images/eb-5-linked.png)

## 4. Save the Application ID

The Application ID is the long code next to the app's name in the Control Panel, for example
`12345678-abcd-...`. Copy it into Omatalous and press *Tallenna ja testaa*. Omatalous tells you right away whether
Enable Banking accepts the key.

## 5. Connect the accounts in Omatalous

Under *Asetukset > Pankkiyhteydet* press *Lisää pankkiyhteys*, choose Nordea, log in and pick an account. Use a phone or
computer on your home Wi-Fi. After the login the browser shows a page on `github.io` for a moment and comes back to
Omatalous. Add the other accounts and cards with *Lisää seuraava tili*.

![Lisää pankkiyhteys](images/lisaa-pankkiyhteys.png)

The first fetch brings up to two years of history in the background.

Check under *Tilit* that each credit card has the type *Luottokortti*. Then paying the card bill from your current
account is counted as a transfer, because the purchases are already counted on the card.

## Good to know

- The bank's consent lasts 180 days. Omatalous reminds you 14 days before. Renew it by connecting the account again
  under *Asetukset > Pankkiyhteydet*. The history stays.
- An account that does not show up is almost always missing from *Linked accounts* in step 3.
- For history older than two years, export a CSV from Nordea's online bank and import it under *Asetukset > Tuo CSV*.
  Rows already fetched are skipped.
- When something fails, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#connecting-the-bank). Other ways to set Enable
  Banking up are in [ADVANCED.md](ADVANCED.md#enable-banking-options).
