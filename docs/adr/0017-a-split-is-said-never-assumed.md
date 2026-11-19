# 0017 A split is said, never assumed (0.66.0)

Holder names give who sees an account. The bank's line of holders tells that an account is joint and who its users are,
and nothing of how they share it. 0016 read two names as two equal weights, so Yhteenveto showed "osuutesi 50 %",
halved the balance and the rows, and Yhteiset menot said one partner had paid more than their share when nobody had
said the share.

Only a member gives a split. A use a member said (`PUT /accounts/:id/use`, `saidUse`) or a settlement agreement is a
split. A use derived from holder names or from who linked the account carries `split: "unknown"` when it has two
users or more. Rows cut by who paid (`mode: "source"`) are a split the household chose, and the weights only share
what nobody owns.

With the split unknown, `partOf` gives each user who sees the account the whole, flagged (`Part.split`), so no figure
is halved by a guess. The member's own view counts the account whole and says "Yhteinen tili, jako kertomatta", and
the app asks once. `UNTOLD` in `account-use.ts` is the one place that choice is made. The settlement leaves a cost no
agreement covers out of paid and owed and lists it in `untold`.

The two own views of such an account add up to more than the account until a member says the split. That is the cost
of not guessing, and the household view still counts the account once.

Where the rows are cut by who paid, the part is not a guess, so the two views do add up. What is ahead of such an
account (`standingCut`) is derived from the recent rows of each series on every read, as the past is: what the trace
says the viewer paid, plus their weighted part of what nobody owns. This is the sliding window 0016 declined for the
weights, and it moves no month's spending: the series and the figures read from them (fixed costs, price rises, housing
charges) use it, and each row of a month stays as it was counted.

A closed month of Yhteiset menot is final. A later change reaches the next open month as a correction only when a member
said something after the closing, such as an answer, a use or an agreement. A cost whose split is not told today says
nothing new, so the comparison leaves it as the month settled it (`settlement`). A change of the app's own rules is no
word of the household either, and must not be read as one.

So every word is dated, and the comparison takes only the rows a word said on or after the closing day reads. An answer
reads the rows paid from the group it names, a use or a split a member chose reads every row of the pool, and an
agreement in force by the month's end reads the rows of its account, from the day it was set or its last partner put it.
A split the app set is no word. Members, holder names, rules and categories carry no date. A row the month never held,
booked after it was stored, is compared too, so its cost lands as a correction.

The opening, the money on the account before its first row, counts as Yhteistä while no answer to it is stored, and it
is not asked. That default is dated on the opening day, so it is no word for a closed month. An answer stored by a
version that asked the opening replaces the default whole, so that household settles every month as before.

Only the latest answer to a key is stored. When En tiedä replaces an answer, the first answer's day is lost, and a month
closed under it moves back to unknown through a correction.

A correction records what it moved by row (`byRow`), and a later one takes off only the rows it reads again, so no
figure is counted twice and none is reversed by a word on other rows.

A cost counted in a fixed month's net cost owes nothing of its own: the month's fixed line owes it. So the fixed line and
every such cost, as the month closed and as it reads today, are compared together or not at all, and a correction always
owes what it pays.

What this leaves:

- A rule that turns a row that was no cost into a cost still corrects the month, since the month never held that row.
- A word that is taken back leaves no date, so it brings no correction and the figure settled with it stands.
- When one cost in a fixed amount is compared, a rule that moved another cost in or out of that amount corrects the
  month too.
- A correction stored before rows were recorded is taken off whole when a word that reads the month was said by its day,
  or the month has rows it never held, and otherwise stands. Such a line compared every row, so a row booked before it
  and never held by the month is in it already; only taking the line off counts that row once. What the line carried for
  a word since taken back is lost then. An answer said before such a line and said again after it is counted twice,
  since only its latest day is stored.
