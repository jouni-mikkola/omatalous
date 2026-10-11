# Connecting Nordea (Enable Banking)

Enable Banking is the service that lets Omatalous read your Nordea accounts. It is free when you read only your own
accounts. You register one Enable Banking app for the household, which takes about 15 minutes.

Omatalous walks you through it in the first-run setup, and later under *Asetukset > Palvelin*. It makes the key, lists
the fields of Enable Banking's registration form with a *Kopioi* button for each value, and tests the Application ID.
This page has what the setup does not show.

## Why there are two links

You log in with Nordea ID twice. That is expected: each login makes a different link. You always log in on Nordea's own
page, and Omatalous can only read transactions and balances.

- The account link in Enable Banking's Control Panel (*Activate by linking accounts*, later *Link accounts*) is the list
  a restricted app may read. Enable Banking lets you use your own accounts with an app you registered yourself, without
  a contract, and only in restricted mode: the API returns the linked accounts and strips every other account from the
  answer.
- The connection in Omatalous (*Asetukset > Pankkiyhteydet > Lisää pankkiyhteys*) is the consent that Omatalous fetches
  with. You give it with Nordea ID, it is valid for 180 days and you renew it before it ends.

Enable Banking's documentation does not say whether a link in the Control Panel expires. It says only that the app stays
active in restricted mode until an agreement is signed. If an account does not show up, check *Linked accounts* first.

## Linking accounts at Enable Banking

On Nordea's page you pick one account at a time. Pick one and press *Jatka*.

![Pick one account](images/eb-4-choose-account.png)

The app is *Active* after the first account. Press *Link accounts* again for each other account and credit card you want
in Omatalous, and link all of them before you connect in Omatalous. A connection made earlier does not bring an account
that was linked afterwards.

![Linked accounts](images/eb-5-linked.png)

## What the setup leaves out

- The private key stays in Omatalous, encrypted. Enable Banking gets only the certificate.
- Do the setup on one computer, so the certificate you download is at hand when you register the app.
- The Application ID is the long code next to the app's name in the Control Panel, for example `12345678-abcd-...`.
- The privacy URL and the terms URL are pages on the same site as the redirect URL. They say that Omatalous runs on your
  own machine, that bank data goes only there and that the developer receives nothing. The form asks for them,
  though Enable Banking does not check them or the email for an app you activate by linking your own accounts.
- Omatalous reads the app's status from Enable Banking. While the app is *Inactive* it says so and keeps *Lisää
  pankkiyhteys* off. Link your accounts, then press *Testaa yhteys*.

## After you connect

- Use a phone or computer on your home Wi-Fi. After the Nordea login the browser shows a page on `github.io` for a
  moment and comes back to Omatalous.
- The first fetch brings up to two years of history in the background. For older history, export a CSV from Nordea's
  online bank and import it under *Asetukset > Tuo CSV*. Rows already fetched are skipped.
- Check under *Tilit* that each credit card has the type *Luottokortti*. Then paying the card bill from your current
  account counts as a transfer, because the purchases are already counted on the card.
- Omatalous reads these fields of each account. The bank's `product` (Käyttötili, ASP-tili, Nordea Gold) becomes the account's name, and
  `name`, which holds the holders ("A;B"), a line under it. `cash_account_type` gives the type; Nordea sends `CACC` for every
  account, so a product with a savings word (säästö, ASP, tuotto, sijoitus) reads as *Säästötili* when the account is first linked (change the type under *Tilit* if it is wrong). A card's masked number
  (`CPAN`) shows as its last four digits and `credit_limit` as its limit. You can give any account a name of your own
  under *Tilit*: a new consent never replaces it. An account linked before these fields were read asks the bank for
  them once at the next fetch; a refusal is tried again at the one after.
- The bank's consent lasts 180 days. Omatalous reminds you 14 days before. Renew it by connecting the account again
  under *Asetukset > Pankkiyhteydet*. The history stays.

## Errors

| What you see | What it means |
|---|---|
| "Enable Banking ei tunnistanut sovellusta" (also with 401), or "Enable Banking hylkäsi avaimen (401)" | The Application ID is not copied in full, or the certificate in Enable Banking is not the one Omatalous made. A new key (*Luo uusi*) makes the old certificate useless. Check both and press *Tallenna ja testaa* again. *Testaa yhteys* under *Asetukset > Palvelin* shows which of the two it is. |
| "Enable Banking ei vielä päästä sovellusta pankkeihin", or "Enable Banking hylkäsi avaimen (403)" | The app is still *Inactive*, or no account is linked. Press *Activate by linking accounts* in the Control Panel, choose Nordea, then press *Testaa yhteys* under *Asetukset > Palvelin*. |
| "Enable Banking ei hyväksy paluuosoitetta" | The address the message names is missing from your app's Redirect URLs. Add it in the Control Panel. |
| An account or a card is missing | It is not under *Linked accounts*. Link it with *Link accounts*, then add it in Omatalous with *Lisää seuraava tili*. |
| "&lt;account&gt;: tiliä ei ole linkitetty Enable Bankingissa", also on the account's row under *Asetukset > Tilit* | The app is restricted and reads only the accounts under *Linked accounts*. Open *API applications*, your app, *Link accounts*, and link that account or card. Then press *Hae nyt*. The other accounts are fetched meanwhile. |
| "&lt;account&gt; ei tullut mukaan uuteen yhteyteen" | The new connection did not bring that account, so it stays on the old one and is not fetched. Link it under *Link accounts* in the Control Panel, then press *Yhdistä uudelleen*. |
| "Pankki ei antanut tilejä" | The connection finished with no accounts, because none was linked at Enable Banking. Link them in the Control Panel and connect again. |
| "Pankki keskeytti yhdistämisen", or "Enable Banking hylkäsi yhdistämisen" | The app's request log in the Control Panel has the reason. The server log has a line `bank link refused` with the status and code. |
| "Yhdistäminen keskeytyi", or "Yhdistäminen vanheni" | The login was cancelled at the bank, or the link was used already or is more than an hour old. Start again with *Lisää pankkiyhteys*. |
| "Enable Banking vastasi virheellä ...", or "Enable Bankingiin ei saatu yhteyttä" | The problem is at Enable Banking or in the machine's connection. Try again later. |

If the browser stays on the `github.io` page or shows an error after the Nordea login, see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#connecting-the-bank).

## A member's own app

A member can use an Enable Banking app of their own for their own connections.
*Asetukset > Oma Enable Banking -sovellus* shows when the household has no shared app, or when the member already uses
an own key.
The member registers it like the household's app, with their own Enable Banking account, with these differences:

- Omatalous makes no key for a member. Choose *Generate in the browser* for the private key. Enable Banking then
  downloads a `.pem` file.
- The redirect URL is the one shown under *Asetukset > Oma Enable Banking -sovellus*. An admin can read the privacy URL
  and the terms URL to you from *Asetukset > Palvelin*.
- Link the member's accounts in their app as above.

Save the Application ID and the `.pem` file under *Asetukset > Oma Enable Banking -sovellus*, then delete the file from
the downloads folder. The key is stored encrypted. The form checks only that the ID and the key are well formed, so a
wrong pair shows up as an error when the member connects. *Poista oma avain* returns the member to the household's app.

More about Enable Banking options: [ADVANCED.md](ADVANCED.md#enable-banking-options).
