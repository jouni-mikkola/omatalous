# Words and style of the interface

Everything the browser shows is Finnish. This page is the glossary and the style sheet of that Finnish: one word for
each thing, and one way to write a sentence, a button, a date and a sum. It is in English because the rest of the
documentation is; the terms and the examples are Finnish and written in italics or quotes.

`pnpm strings` lists every text the browser can show with its file and line. Start a change of Finnish text there.

## Glossary

Use the term in the first column. The second column holds the words that were removed or that are easily mixed up
with it. A new word for a thing already named here is not added: the term below stays.

| Thing | Use | Do not use |
|---|---|---|
| An account that holds or uses money | *tili*; *Tilien saldo* when the figure is the sum | *Tileillä* as the name of a figure, *varat* for the sum on the accounts |
| The balance of the savings and checking accounts | *Säästö- ja käyttötilien saldo* (cards and loans are not in it) | *Tileillä*, *Tilien saldo* for this figure |
| The balance of accounts and cards together | *Tilien ja korttien saldo* (the same figure as *Varat velkojen jälkeen*) | *Tileillä* |
| Account balances less card debt (and loans, when known) | *Varat velkojen jälkeen* | *Nettovarat*, *Netto*, *Tileillä*, *Varallisuus* |
| The section of accounts and debts | *Varat ja velat* | *Varallisuus* |
| Income less spending of a month | *Tulos*; in the reports *Käteen jäi* | *Yli jäi*, *Jäännös*, *jäämä* |
| Income and spending as short labels (a table, a row of figures) | *Tulot*, *Menot*, *Erotus* | *Maksettu*, *Saatu*, *Ero* |
| Every movement of the filtered rows on Tapahtumat, own transfers left out | *Rahaa ulos*, *Rahaa sisään*, *Erotus* | *Menot*, *Tulot* (those are consumption and income elsewhere) |
| Taking a bank connection into use | *yhdistä* (a bank, an account), *Yhdistä uudelleen* | *linkitä*, *liitä* (*liitä osoite* stays: that is pasting text) |
| How long a bank connection is valid | *suostumus* (*Uusi suostumus*), the connection *vanhenee* | *lupa*, *consent*, *yhteyden päättyminen* |
| Getting new data from the bank | *Hae nyt* (the action), *päivitetty* (the state), *Päivitykset* (the log) | *Haettu*, *Päivitykset* |
| The queue of questions the app cannot answer | *Tarkistettavat* (the name), *kysymys* (one item) | *tarkistus*, *tarkistettu* |
| The app's own check of its work | *tarkistaa* ("Tarkistimme 21 asiaa") | *Tarkistettu* |
| A suggestion that saves money | *Säästövinkki* | *Optimoi*, *optimointi* |
| The user's rule that sorts into a category | *Sääntö*; *Kauppiaat ja säännöt* | *Muistisääntö*, *Hakusääntö* |
| A person without a login | *jäsen ilman kirjautumista* | *Jäsen ilman tunnusta* (short form: *ilman kirjautumista*) |
| All accounts of the household | *Koko talous* | *Kaikki tilit* |
| The user's own name for an account | *Tilin nimi* (also the label of the field) | *Oma nimi* |
| What a month usually costs | *tavallinen* ("Tavallinen 2 825 € (viime 6 kuukauden keskiarvo)"), for income *tavalliset tulot*. The text names what it rests on. In Kuukausi, Saldot and Velat the word is *yleensä* ("Yleensä 2 825 €") | *odotettu*, *odotetut tulot*, *normaali*, *keskitaso* |
| The range a figure usually moves in | *tavallisesti 2 700–3 260 €* | *vaihteluväli*, *prosenttipiste*, *5.–95. prosenttipiste* |
| A forecast in a report (Saldot) | the reader as subject, a rounded figure and a plain range: "Sinulle jää noin 4 800 €. Se voi olla 3 900–5 700 €." Columns *Arvio*, *Alin*, *Ylin* | *Todennäköisin*, *Todennäköinen väli*, *Säästöön kertynyt* |
| The parts a report figure is made of | *Mistä luku koostuu* | *Luvun osat* |
| The difference to the usual in a Kuukausi table | *Yli tai alle*, the total *Yhteensä* | *Erotus* in the reports of Kuukausi, Saldot and Velat |
| A loan payment in the Velat report | *maksu*, *kuukausimaksu* | *erä*, *maksuerä*, *tasaerä* |
| A month that is over | *päättynyt kuukausi* | *valmis kuukausi* |
| The group a transaction belongs to | *kategoria* | *ryhmä*, *luokka* |
| How sure an estimate is | *Arvio on epävarma*, *suuntaa antava*, *luotettava* | *Varmuus keskitaso*, *Peruste*, *Vaikutus* |
| The usual level of a payer, a bill or the savings rate | *tavallisesti* | *normaali* |
| The bills before payday without the card's bill | *Muut laskut ennen palkkapäivää* (the card's bill is *Korttivelka*) | *Maksut ennen palkkapäivää* beside a figure that holds the card |
| A month with all its days | *päättynyt kuukausi* | *valmis kuukausi*, *täysi kuukausi*, *kokonainen kuukausi* |
| Confirming | the verb that names the act: *Poista*, *Tallenna*, *Peruuta* | *Kyllä*, *Ei*, *OK* |
| Abbreviations | *kaupparekisteri* for YTJ; CSV is explained at its first use; API and PSD2 only for the administrator | |
| English names | only as a quotation of another service's own word ("Link accounts") | whole English sentences |

Enable Banking's panel has its own English names. A text may quote them in quotes or parentheses, and says the step in
Finnish: *Lisää tilit Enable Bankingissa (API applications > Omatalous > Link accounts)*. The step to take there is
*lisää*; the word *linkitä* is not used.

A glossary row is changed together with the text that breaks it. Rules 12 and 28 of the repo rules keep some older
words out (*tilitapahtuma*, *löydös*, *kulut* for spending), and rule 35 keeps out the four named in the table:
*Optimoi*, *Yli jäi*, *Tileillä* as the name of a figure and *linkitä*. It also refuses the passive *Näin katetaan*, *katetaan*,
a text that begins with *Luetaan*, *Testataan*, *Tarkistetaan* or *Lasketaan*, and a question heading that begins with
*Mihin*, *Miten*, *Mistä*, *Mitkä*, *Milloin*, *Kuinka*, *Paljonko*, *Kestääkö* and the like. The last two are not yet
enforced for the files of the parts still to come (`pending` in `tools/repo-rules/glossary.ts`).

## Style

### Tone

Write the way a Finnish bank (OP, Nordea, S-Pankki) or a good Finnish web service writes: to the reader, in the active
voice, in plain standard Finnish. No bureaucratic language and no slang. No exclamation marks, no "Oho!", no scolding
("Unohdit…", "Sinun pitää…"). The te-form is never used.

- Address the reader as *sinä*: *Laskusi on maksettu*, *Sinulle jää laskujen jälkeen 420 €*, *Yhdistä pankki*.
- Say who does what. The app speaks of itself in the first person plural when it does something: *Haemme
  tapahtumia…*, *Emme voi laskea puskuria*. Choose one form and keep it. A loading line may be the short passive
  (*Ladataan…*), because that is the shortest natural form there.
- Not *Laskut katetaan*, *Luetaan kuvaa…*, *Testataan…* or *Tapahtumat haetaan*. Not *Näin katetaan*.
- A person who has no name in the app is *käyttäjä*, never *hän* or *he*. A sentence about the household's own money
  speaks to the reader: *Kirjaudut ulos kaikilta laitteilta.*

### Sentences

The number and its meaning first, the explanation after it and short. One thing in a sentence, 20 words at most. No
repeating, and no inner jargon (*pohja*, *peruste*, *odotettu* with no word on what it rests on). Say what the reader can
do, not what the system could not do. An error says what happened and what can be done: "Pankki ei vastannut. Yritä
hetken kuluttua uudelleen." The text of an exception or a status code is not shown. A full stop ends a sentence; a
button has none. Waiting is one character, "…", as in "Ladataan…".

Before and after, from the app:

| Before | After |
|---|---|
| Laskut katetaan. Laskujen jälkeen jää 420 € | Laskuihin riittää. Laskujen jälkeen sinulle jää 420 € |
| Riittävätkö rahat seuraavaan palkkaan? | Rahat seuraavaan palkkaan |
| Mihin raha menee? | Rahankäyttö |
| Miten tämä kuukausi menee? | Kuukausi |
| Kestääkö puskuri? | Velat |
| Mistä ero tulee | Erot kategorioittain |
| Tapahtumia ei saatu haettua pankista. | Emme saaneet tapahtumia pankista. |
| Budjettia ei ole vielä asetettu. | Et ole vielä asettanut budjettia. |
| Luokittelematta 450 €. Luokittele ne… | (kept: it already speaks to the reader) |
| Luottoa nostettiin 1 200 €. | Nostit luottoa 1 200 €. |
| Palkka on myöhässä, joten palkkapäivän jäävää summaa ei lasketa. | Palkkasi on myöhässä, joten emme voi laskea, paljonko palkkapäivänä jää. |
| Poistetaanko menotavoite? | Poista menotavoite? |
| Tapahtumia ei saatu haettua pankista. | Emme saaneet tapahtumia pankista. |
| Ensimmäinen haku on kesken. Luvut täsmentyvät, kun tapahtumat on haettu. | Ensimmäinen haku on kesken. Luvut tarkentuvat, kun olemme hakeneet tapahtumat. |
| Jaksolla nostettiin luottoa 800 € | Nostit jaksolla luottoa 800 € |

### Buttons and links

A button is a verb in its base form: *Tallenna*, *Peruuta*, *Poista*, *Hae nyt*, *Yhdistä pankki*. It tells the act
without the text around it: *Lue lainan tiedot*, not *Lue tiedot*. A link names where it leads: *Laskut*, *Kaikki
menot*.

### Confirming and undoing

Something that cannot be taken back is asked first, in a `ConfirmDialog` (never the browser's own `confirm`, rule 36).
The title is the act and the thing, like *Poista lasku X?*. One sentence tells what follows. The buttons
are the act and *Peruuta*, such as *Poista laina*, never *Kyllä* and *Ei*. Focus starts on *Peruuta*. Closing the dialog
by any way returns focus to the button that opened it.

A change that is easy to take back is not asked. It is done, the message says what happened, and *Kumoa* takes it back.
A category change says the rule it made.

### The frame of a page

- The header has the pages, Tarkistettavat and the user menu.
- Tarkistettavat shows the count of open questions. The page shows the same number.
- The user menu has the pages a module adds (on a phone only: a wider screen has them in the header), Asetukset, the other language (a button named in that language) and Kirjaudu ulos. The password is in Asetukset > Turvallisuus.
- A phone has five tabs. They are Yhteenveto, Laskut, Tapahtumat, Raportit and Säästövinkit. There is no Lisää screen: Asetukset and the pages a module adds are in the user menu, and `#/more` opens Yhteenveto.
- The foot of the page tells when the rows were fetched (`Päivitetty 23.10. klo 18.15`). Only a failed fetch is above the page, in a `Notice`.

### Headings

A short noun, as in an online bank: *Rahankäyttö*, *Kuukausi*, *Laskut*, *Säästöt*, *Tulot*. Not a question
(*Mihin raha menee?*, *Miten tämä kuukausi menee?*, *Mistä ero tulee?*) and not a sentence with a full stop. No capitals
and no bold inside a heading. The same name is used wherever the thing is named: the menu, the page and the link to it.

This holds for every name in the app (navigation, page titles, cards, tabs, buttons that name a place): a short noun, never a question or a sentence. *Mihin raha menee* is poor, *Rahankäyttö* is right.

### Capitals

A capital begins a sentence or a proper name. The names of the pages (*Tapahtumat*, *Asetukset*) have a capital when
they are the name and are small otherwise ("tapahtumat" for the transactions in a sentence).

### Dates and times

| What | Write | Not |
|---|---|---|
| A date | `23.10.2026`, with no leading zeros | `23.10.26`, `23. lokakuuta` where space is short |
| A date in the year now | `23.10.` | |
| A period | `1.10.2025–30.9.2026`: an en dash and no spaces | `1.10.2025 – 30.9.2026`, `1.10.2025-30.9.2026` |
| A period in one year | `10.–30.9.2026` | the year twice |
| A weekday | short and small (*ti 10.11.*), only when it matters | |
| A time | `klo 6.15`, `klo 18.15`, `klo 0.15`: a full stop between hours and minutes, no zero before the hour, always *klo* | `06.15`, `6:15`, `21.52` with no *klo* |
| A time span | `klo 6.15–18.15` | |
| A time stamp | the year only when it is not this year: `23.10. klo 18.15`, `23.10.2025 klo 18.15` | |

### Numbers and money

- A decimal comma; a space between thousand groups (`1 339,64 €`). The euro sign follows the number after a
  non-breaking space.
- A minus is `−` (U+2212), never a hyphen. A hyphen before a digit in a text is refused by rule 12.
- A headline figure stands alone and is whole euros (`5 014 €`): the answer line, a card, a tip, the totals of a list.
  A table and a sum that adds up show cents (`5 014,06 €`), so the rows meet the total to the cent. A table row, a
  basis and a sum row are the second kind even when a headline stands beside them. The sum row of the first page
  is one: it is the working of the answer line above it.
- One euro rule: the headline is whole euros, a table is cents, and a sum is added in cents before it is rounded. Each
  term of a sentence is its own sum rounded (`printedEuros`), never moved a euro to make the words add up. Two figures
  that differ only by rounding (32 202 and 32 203) are not shown on one page. Figures that differ by what they count get
  different names that say so.
- One block does not say one figure in both forms: a sentence or a title holds whole euros or cents, not both.
- A percentage is `12 %`, with a space.
- A rate is `113 €/kk` in a column of values and "113 € kuussa" in a sentence. *vuodessa* follows the same rule.
  `kk`, `krt`, `kpl`, `esim.` and `vs.` are not written in a sentence.

### Plurals

Counts go through `plural()` (`1 tapahtuma`, `2 tapahtumaa`). A form such as *tapahtuma(a)* is not written.

## English

English is the second language, chosen by each member in the user menu and stored on the
member (`users.language`). Finnish stays the default. The message catalogue (`packages/core/src/messages.ts`) holds both:
the Finnish table gives the codes, the English table must have the same codes and the same `{holes}`, and the build and
`messages.test.ts` fail for a code without an English text. The server sends a code with its parameters, and the browser
formats it in the member's language. A text that is not in the catalogue yet is Finnish in both languages; moving the
rest of the texts into it is the work still open (docs/ROADMAP.md, English beside Finnish). The areas are files beside
`messages.ts` (`messages-shell.ts` holds the frame of the app). Each area's English table is a file of its own in
`packages/core/src/english/`, and the Finnish tables the sign-in does not read are gathered in `messages-late.ts`: the browser
fetches English (`@banking/core/english`) only for a member who reads it and the rest of Finnish (`@banking/core/late`) beside
the sign-in answer, so the entry stays within its budget (`apps/web/src/language.ts`); the server and the tests import both. The web reads a text with `t(code, params)`, and
`e2e/english-scan.spec.ts` lists the pages whose whole text is scanned for Finnish words.

English text is short and plain, like the Finnish: sentence case, no filler. Sums and dates follow the language through
`money`, `date` and the other formatters of `apps/web/src/format.ts`: `€1,234.56`, `9/10/2026`, `Mon 12/10`. The locale of
each language is named once in `packages/core/src/locale.ts`. `pnpm strings` lists the texts of both tables.

## Keeping it

- A word of the glossary that a text breaks is a defect, also when no rule finds it.
- A new word for a thing is a row here first. A word that is removed goes into `tools/repo-rules/glossary.ts` with a
  case in `glossary.test.ts` (a text that uses it and a near miss), and the glossary row says so.
- Rule 35 refuses the removed words in every text `pnpm strings` lists. Text between double quotes is another service's
  own word and passes.
- Rules 12 and 28 hold the rest of the style that a machine can see. A text that must keep a refused word needs the
  pattern narrowed with a near miss in its test, not a list of exceptions.
- A change that adds or changes Finnish text ends with `pnpm strings --file <path>` read through once.
