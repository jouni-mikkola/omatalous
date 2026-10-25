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
| Account balances less card debt (and loans, when known) | *Nettovarat* | *Netto*, *Tileillä*, *Varallisuus* |
| The section of accounts and debts | *Varat ja velat* | *Varallisuus* |
| Income less spending of a month | *Tulos* | *Yli jäi*, *Jäännös* |
| Income and spending as short labels (a table, a row of figures) | *Tulot*, *Menot*, *Erotus* | *Maksettu*, *Saatu*, *Ero* |
| Taking a bank connection into use | *yhdistä* (a bank, an account), *Yhdistä uudelleen* | *linkitä*, *liitä* (*liitä osoite* stays: that is pasting text) |
| How long a bank connection is valid | *suostumus* (*Uusi suostumus*), the connection *vanhenee* | *lupa*, *consent*, *yhteyden päättyminen* |
| Getting new data from the bank | *Hae nyt* (the action), *päivitetty* (the state), *Päivitykset* (the log) | *Haettu*, *Haku pankista* |
| The queue of questions the app cannot answer | *Tarkistettavat* (the name), *kysymys* (one item) | *tarkistus*, *tarkistettu* |
| The app's own check of its work | *tarkistaa* ("Tarkistimme 21 asiaa") | *Tarkistettu* |
| A suggestion that saves money | *Säästövinkki* | *Optimoi*, *optimointi* |
| The user's rule that sorts into a category | *Sääntö*; *Kauppiaat ja säännöt* | *Muistisääntö*, *Hakusääntö* |
| A person without a login | *jäsen ilman kirjautumista* | *Jäsen ilman tunnusta* (short form: *ilman kirjautumista*) |
| All accounts of the household | *Koko talous* | *Kaikki tilit* |
| The user's own name for an account | *Tilin nimi* (also the label of the field) | *Oma nimi* |
| The usual level | *tavallisesti* | *keskimäärin* (the mean is a different figure), *normaali* |
| A month with all its days | *valmis kuukausi* | *täysi kuukausi*, *kokonainen kuukausi* |
| Confirming | the verb that names the act: *Poista*, *Tallenna*, *Peruuta* | *Kyllä*, *Ei*, *OK* |
| Abbreviations | *kaupparekisteri* for YTJ; CSV is explained at its first use; API and PSD2 only for the administrator | |
| English names | only as a quotation of another service's own word ("Link accounts") | whole English sentences |

Enable Banking's panel has its own English names. A text may quote them in quotes or parentheses, and says the step in
Finnish: *Lisää tilit Enable Bankingissa (API applications > Omatalous > Link accounts)*. The step to take there is
*lisää*; the word *linkitä* is not used.

A glossary row is changed together with the text that breaks it. Rules 12 and 28 of the repo rules keep some older
words out (*tilitapahtuma*, *löydös*, *kulut* for spending), and rule 35 keeps out the four named in the table:
*Optimoi*, *Yli jäi*, *Tileillä* as the name of a figure and *linkitä*.

## Style

### Tone

Calm, plain and warm. Address the reader as *sinä* only when there is no way round it; mostly write without a pronoun
("Hae tapahtumat uudelleen."). No exclamation marks, no "Oho!", no blame ("Et ole vielä…"). The te-form is never used.
A person who has no name in the app is *käyttäjä*, never *hän* or *he* ("Käyttäjä kirjataan ulos kaikilta laitteilta.").

### Sentences

One thing in a sentence, 20 words at most. Say what the reader can do, not what the system could not do. An error says
what happened and what can be done: "Pankki ei vastannut. Yritä hetken kuluttua uudelleen." The text of an exception
or a status code is not shown. A full stop ends a sentence; a button has none. Waiting is one character, "…", as in
"Ladataan…".

### Buttons and links

A button is a verb in its base form: *Tallenna*, *Peruuta*, *Poista*, *Hae nyt*, *Yhdistä pankki*. It tells the act
without the text around it: *Lue lainan tiedot*, not *Lue tiedot*. A link names where it leads: *Laskut*, *Kaikki
menot*.

### Headings

A name or a question, not a sentence with a full stop. A question is used only when the answer under it is one
sentence. No capitals and no bold inside a heading.

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
- Cents are shown in tables and on transactions. A card and a headline figure show whole euros. One figure does not
  change its form on one page.
- A percentage is `12 %`, with a space.
- A rate is `113 €/kk` in a column of values and "113 € kuussa" in a sentence. *vuodessa* follows the same rule.
  `kk`, `krt`, `kpl`, `esim.` and `vs.` are not written in a sentence.

### Plurals

Counts go through `plural()` (`1 tapahtuma`, `2 tapahtumaa`). A form such as *tapahtuma(a)* is not written.

## Keeping it

- A word of the glossary that a text breaks is a defect, also when no rule finds it.
- A new word for a thing is a row here first. A word that is removed goes into `tools/repo-rules/glossary.ts` with a
  case in `glossary.test.ts` (a text that uses it and a near miss), and the glossary row says so.
- Rule 35 refuses the removed words in every text `pnpm strings` lists. Text between double quotes is another service's
  own word and passes.
- Rules 12 and 28 hold the rest of the style that a machine can see. A text that must keep a refused word needs the
  pattern narrowed with a near miss in its test, not a list of exceptions.
- A change that adds or changes Finnish text ends with `pnpm strings --file <path>` read through once.
