# Connecting a bank

Omatalous reads your accounts through [Enable Banking](https://enablebanking.com), a service that is free when you
read only your own accounts. You register one Enable Banking app for the whole household. It takes about 15 minutes,
once.

The app shows these steps in its setup after the first login, and later under
*Asetukset > Pankit ja tilit > Pankkisovellus*, behind *Näytä ohje*. Do them on one computer in your home network.

## The steps

1. Sign in to Enable Banking from the link in the setup. It sends a sign-in link to your email.
2. In Omatalous, press *Luo avain*. A certificate file, `talous-enablebanking.crt`, downloads by itself.
3. At Enable Banking, open *API applications* and press *Add a new application*. Choose *Production*, then *Generate
   outside the browser and import public certificate*, and pick the certificate file. Omatalous shows the value of
   each other field, and a click copies it. The email for data protection matters is your own. Press *Register*.
4. Press *Activate by linking accounts*. Choose Finland, your bank and *Personal*, and log in at your bank. Then press
   *Link accounts* for each other account and credit card you want in Omatalous.
5. Paste the Application ID from Enable Banking into Omatalous. Omatalous tests it and saves it.
6. Press *Yhdistä pankki*, choose your bank and log in at the bank once more. The browser comes back to Omatalous.

The first fetch then runs in the background and brings up to two years of history. A card often gives less.

You log in at the bank twice, in steps 4 and 6. The first login tells Enable Banking which accounts your app may
read. The second gives Omatalous the right to read them. Both happen on your bank's own page, and Omatalous never sees
your bank login.

A bank's page may let you pick only one account at a time, as Nordea's does. Then repeat steps 4 and 6 for each
account.

## Which banks

*Yhdistä pankki* lists the banks your Enable Banking app offers, from these: Nordea, OP, Danske Bank, S-Pankki,
Säästöpankki, Oma Säästöpankki, POP Pankki, Aktia, Ålandsbanken, Bank Norwegian, Resurs Bank, Morrow Bank, Eurocard,
Finnair Plus Mastercard, SAS EuroBonus Mastercard, Holvi and Revolut.

Omatalous was built with Nordea's data and knows its wording best. With another bank, check the categories of the
first month under *Tapahtumat* and change what is wrong.

## After you connect

- Check under *Asetukset > Pankit ja tilit* that each credit card has the type *Luottokortti*. Paying the card bill
  from your current account then counts as a transfer, because the purchases are already counted on the card.
- A connection lasts 180 days, or less when the bank's own limit is shorter. The page says when each one ends, and
  Omatalous reminds you before it does. Renew with *Yhdistä uudelleen* on its row. The history stays.
- To add an account later, link it at Enable Banking with *Link accounts* first and then connect again with
  *Yhdistä pankki*.
- If the browser does not come back to Omatalous after the bank login, copy the whole address from the address bar,
  paste it under *Jos yhdistäminen jäi kesken* in *Asetukset > Pankit ja tilit* and press *Viimeistele*.
- *Poista* on a connection's row ends the right to read that bank. The accounts and transactions already fetched
  stay.

## Errors

| What you see | What to do |
|---|---|
| "Enable Banking ei tunnistanut sovellusta" or "Enable Banking hylkäsi avaimen" | The Application ID is not copied in full, or the certificate at Enable Banking is not the one Omatalous made. A new key (*Luo uusi*) makes the old certificate useless. Check both and press *Tallenna ja testaa*. |
| "Enable Banking ei vielä päästä sovellusta pankkeihin" | The app is still *Inactive*, or no account is linked. Press *Activate by linking accounts* in the Control Panel and choose your bank, then press *Testaa yhteys*. |
| "Enable Banking ei hyväksy paluuosoitetta" | The address the message names is missing from your app's redirect URLs. Add it in the Control Panel. |
| An account or a card is missing, or the page says "tiliä ei ole lisätty Enable Bankingissa" | Your app reads only the accounts linked to it. Link the account in the Control Panel with *Link accounts*, then press *Hae nyt*. If it is still missing, connect again with *Yhdistä pankki*. |
| "ei tullut mukaan uuteen yhteyteen" | The new connection did not bring that account. Link it with *Link accounts*, then press *Yhdistä uudelleen*. |
| "Pankki ei antanut tilejä" | No account was linked at Enable Banking. Link them in the Control Panel and connect again. |
| "Pankki keskeytti yhdistämisen" or "Enable Banking hylkäsi yhdistämisen" | The app's request log in the Control Panel has the reason. |
| "Yhdistäminen keskeytyi" or "Yhdistäminen vanheni" | The login was cancelled at the bank, or the link was used already or is more than an hour old. Start again with *Yhdistä pankki*. |
| "Enable Banking ei vastaa juuri nyt", "Enable Banking ei hyväksynyt pyyntöä", "Enable Banking rajoitti hakuja" or "Emme saaneet yhteyttä Enable Bankingiin" | The problem is at Enable Banking or in the machine's connection. Try again later. |
| The bank list is empty, or lacks your bank | Your Enable Banking app does not offer that bank. Check the app under *Asetukset > Pankit ja tilit > Pankkisovellus*. |

More fixes are in [Troubleshooting](TROUBLESHOOTING.md#connecting-the-bank). A member's own Enable Banking app and the
other return addresses are in [Advanced setups](ADVANCED.md#enable-banking-options). What a developer needs to know
about the connection is in [Bank connection notes](BANK_NOTES.md).
