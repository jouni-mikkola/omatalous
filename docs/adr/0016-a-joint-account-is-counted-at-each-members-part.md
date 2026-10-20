# 0016 A joint account is counted at each member's part (0.12.0)

Superseded in part by [0017](0017-a-split-is-said-never-assumed.md): holder names give no split, so a joint account nobody split counts whole, flagged.

## Context

A joint account that both partners connect is two rows of `accounts`, one for each partner's bank consent, and the bank
gives them one identity. Koko talous already held it once. A member's own view held the member's copy whole, so the two
partners' own views each held all of the account's balance, all of the spending on it and all of a mortgage paid from
it, and together they showed the household more than it had. A member could not tell what was theirs: the joint
account's balance was not their money, and the mortgage was not their debt alone.

The household's own words say it differently. A couple pays 600 € and 400 € a month into the account that pays the
mortgage, and the bank's line of holders tells that the account is joint, not in what parts.

## Decision

A member's own view counts a joint account at the member's part, and Koko talous counts it whole. MONEY_FLOWS.md (*Joint
accounts*) holds what each figure means.

- **Who uses an account** is the bank's line of holders, in equal parts, derived on every read and stored nowhere. The
  member who linked an account can say another use, in euros a month for each user; only the ratio counts. The statement
  is for the real account (`account_use`, keyed by the bank's identity), so two copies cannot disagree. A use never
  widens access: who may see an account stays with its shares.
- **A row is cut to the part when the view is loaded** (`applyUse`), so every report follows with no change in it. The
  rows of the SQL sums are cut by one expression that a test holds equal to `partCents`.
- **A part is a range of the users' weights**, and `partCents` rounds both ends of the range the same way. The users'
  parts of an amount add up to the amount, so the own views of the members add up to Koko talous, to the cent, for
  members who see the same accounts.
- **A debt follows the account behind it.** A connected card or loan account has its own part. A saved loan has the
  part of the account its payments leave, which its series key tells, whoever typed it in; a view holds the loans of
  other members paid from an account it counts (`loansInView`).
- **The payday window counts the accounts the member uses alone**, or the joint ones at the part when there are none.
  The windows of two members do not add up to the household's, because each answers whether that member's money lasts.

## Weighed and left

- **Whole in every view**, as before. It is the least work, and the household's own view cannot be wrong about the
  household. It shows each member the whole account, so the members' views add up to more than the household has, and
  the member's own spending, saving and debt are not the member's.
- **A split by the number of holders only.** It needs nothing from the household, and it is the default when nobody has
  said otherwise. It is wrong for a couple that pays unequally, and a household that cannot say its parts cannot make it
  right. Only the ratio of the weights is used, so the household types what it knows (600 and 400) and no percent.
- **Parts derived silently from what each user paid in.** The app proposes the weights from the last six complete months
  and the member takes them with one press. Derived on every read they would move whenever the window slides, and the
  figures of an old month would change with them.
- **One shared copy of the account for the household.** Every row has a `user_id`, financial data is reached through a
  repository bound to one user, and each member's rows are categorised on their own. One record for the account would
  need an owner and a second way to see it, and an account that only one partner linked has no second copy to merge.
- **A part on the account row.** A statement kept on each copy can disagree, and a partner who did not link the
  account could not say it. A table keyed by the real account has one statement.

## Consequences

- The member's own view is what the member uses, and an account that others use alone is not in it. Koko talous is the
  household's, whole, and exists when something is shared with the member or one of the member's accounts is at less
  than the whole.
- Statistics that cannot add up (a median, a threshold, the usual spending) are not the sum of the members' own. The
  payday windows and Tapahtumat's money in in Koko talous do not add up either, and MONEY_FLOWS.md lists the other
  known limits.
- A use has no start date. Changing it restates the months before it. A part that changes over time is a later
  decision, if a household asks.
- Three readers need the bank's amount and not the part, and read it from the row (`billCents`): the match of a typed bill,
  the match of a loan's payments and Säästövinkit, which counts joint accounts whole in every view.
- What one member sees of another is the display names of an account's users, and the loans of other members paid from
  an account in view, with the typist's name. SECURITY.md (*Who sees what*) lists it.
- The cache entry of a view holds the viewer's part of each account in its version, so a changed use or share does not
  serve the old view.
- Migration 0018 adds the table `account_use` with a compat floor of 0.10.0, so a rollback keeps what was said.

## When to think again

- When a household needs a part that changes over time: the use then has a start date, and the months before it keep
  the part they had.
- When the bank gives each holder's own share of an account: the share is then given and not derived or typed.
- When `/api/meta` says who sees an account, the suggestion route need not answer it, and Tilit needs one request less.
