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

## 2. Register the app

Press *Avaa Enable Banking* in the checklist, or open <https://enablebanking.com/cp/applications>. If you have no
account, make one at <https://enablebanking.com/sign-in/>. Enable Banking creates it on the first sign-in. Choose
*Add a new application*.

![Add a new application](images/eb-1-register.png)

The checklist lists the form's fields in the form's order. Each value you paste has a *Kopioi* button.

1. Environment: *Production*.
2. Private key: *Generate outside the browser and import public certificate*. Choose the `.crt` file from step 1.
3. Application name: `Omatalous`.
4. Allowed redirect URLs: the redirect URL the checklist shows. For a normal install it is
   `https://jouni-mikkola.github.io/omatalous/callback/`.
5. Application description: `Omatalous: kotitalouden oma taloussovellus`.
6. Email for data protection matters: your own email address. Omatalous does not store one, so it cannot fill it in.
7. Privacy URL: `https://jouni-mikkola.github.io/omatalous/privacy/`.
8. Terms URL: `https://jouni-mikkola.github.io/omatalous/terms/`.

The two pages sit on the same site as the redirect URL. They say that Omatalous runs on your own machine, that bank
data goes only there and that the developer receives nothing. Enable Banking does not check the email and the two URLs
for an app you activate by linking your own accounts, but the form asks for them.

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
Enable Banking accepts the key. It also reads the app's status from Enable Banking. While the app is still *Inactive*
Omatalous says so and keeps *Lisää pankkiyhteys* off. Link your accounts (step 3), then press *Testaa yhteys*.

## 5. Connect the accounts in Omatalous

Under *Asetukset > Pankkiyhteydet* press *Lisää pankkiyhteys*, choose Nordea, log in and pick an account. Use a phone or
computer on your home Wi-Fi. After the login the browser shows a page on `github.io` for a moment and comes back to
Omatalous. Add the other accounts and cards with *Lisää seuraava tili*.

![Lisää pankkiyhteys](images/lisaa-pankkiyhteys.png)

The first fetch brings up to two years of history in the background.

Check under *Tilit* that each credit card has the type *Luottokortti*. Then paying the card bill from your current
account is counted as a transfer, because the purchases are already counted on the card.

## Why accounts are linked twice

Step 3 and step 5 are two different things.

- *Linked accounts* in the Control Panel is the list a restricted app may read. Enable Banking lets you use your own
  accounts with an app you registered yourself, without a contract, and only in restricted mode: the API returns the
  linked accounts and strips every other account from the answer.
- The connection in Omatalous is the consent that Omatalous fetches with. You give it with Nordea ID, it is valid for
  180 days and you renew it before it ends.

Enable Banking's documentation does not say whether a link in the Control Panel expires. It says only that the app
stays active in restricted mode until an agreement is signed. If an account does not show up, check *Linked accounts*
first.

## Good to know

- The bank's consent lasts 180 days. Omatalous reminds you 14 days before. Renew it by connecting the account again
  under *Asetukset > Pankkiyhteydet*. The history stays.
- An account that does not show up is almost always missing from *Linked accounts* in step 3.
- For history older than two years, export a CSV from Nordea's online bank and import it under *Asetukset > Tuo CSV*.
  Rows already fetched are skipped.
- When something fails, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#connecting-the-bank). Other ways to set Enable
  Banking up are in [ADVANCED.md](ADVANCED.md#enable-banking-options).
