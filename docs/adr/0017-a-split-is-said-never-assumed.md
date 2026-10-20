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
