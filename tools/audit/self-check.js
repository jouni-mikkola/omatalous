// A self-check for a signed-in admin, run in the page's console (tools/audit/README.md). It reads the instance's own
// API with GET requests, one at a time and at most MAX_REQ in all, finds where figures that must agree do not, and
// returns one JSON string of category ids, months, counts and sums in cents. No name, IBAN, description, reference
// or counterparty text is ever put in it. Plain browser JavaScript: no import, nothing from the page but fetch.
(async () => {
  const LIMIT = 6000, MAX_REQ = 40, PAGE = 5000, MAX_FAIL = 40;
  const fails = [], skips = {}, extra = {}, counts = {}, secret = new Set();
  let reqs = 0;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const iso = (s) => (typeof s === "string" && /^\d{4}-\d\d-\d\d$/.test(s) ? s : null);
  const sum = (xs) => xs.reduce((s, x) => s + x, 0);
  const sec = (...v) => v.forEach((s) => typeof s === "string" && s.length >= 4 && secret.add(s.toLowerCase()));
  const q = (o) => "?" + Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const stamp = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const days = (a, b) => Math.round((stamp(b) - stamp(a)) / 864e5);
  const addM = (m, n) => {
    const k = +m.slice(0, 4) * 12 + +m.slice(5, 7) - 1 + n;
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
  };
  const lastDay = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
  const get = async (path) => {
    if (reqs >= MAX_REQ) return { err: "the request limit was reached" };
    reqs++;
    try {
      const r = await fetch(path, { headers: { accept: "application/json" }, credentials: "same-origin" });
      return r.ok ? { v: await r.json() } : { err: `${path.split("?")[0]} answered ${r.status}` };
    } catch (e) {
      return { err: `${path.split("?")[0]} failed (${String((e && e.name) || "error")})` };
    }
  };
  /** A failure line; `m` is the money at stake and only orders the lines. */
  const fail = (check, code, where, expected, got, m = 0) => {
    fails.push({ code, where, expected: String(expected), got: String(got), m: Math.abs(m) });
    counts[check] = counts[check] || { n: 0, bad: 0 };
    counts[check].bad++;
  };
  const tick = (check, n = 1) => ((counts[check] = counts[check] || { n: 0, bad: 0 }).n += n);
  /** One comparison: a line when the two figures differ. */
  const cmp = (check, code, where, expected, got) => {
    tick(check);
    if (expected !== got) fail(check, code, where, expected, got, num(expected) !== null && num(got) !== null ? expected - got : 0);
  };
  const skip = (check, why) => (skips[check] = [...new Set([...(skips[check] || []), `not checked: ${why}`])]);
  /** The lines of the answer's `checks`, one for each check. */
  const verdict = () =>
    Object.fromEntries(
      ["all", 1, 2, 3, 4, 5, 6, 7, 8]
        .map((c) => [c, [counts[c] ? `${counts[c].n} figures compared, ${counts[c].bad} differ` : "", extra[c], ...(skips[c] || [])].filter(Boolean).join("; ")])
        .filter(([, v]) => v),
    );

  // ── what the instance says of itself ──
  const metaAnswer = await get("/api/meta");
  const M = obj(metaAnswer.v);
  if (metaAnswer.err) skip("all", `/api/meta: ${metaAnswer.err}`);
  const today = iso(M.today) || new Date().toISOString().slice(0, 10);
  const thisM = today.slice(0, 7), lastM = addM(thisM, -1);
  const months = Array.from({ length: 13 }, (_, i) => addM(thisM, i - 12));
  const kinds = new Map(arr(M.categories).map((c) => [obj(c).id, obj(c).kind]));
  const catId = (id) => (kinds.has(id) ? id : "unknown-category");
  const accounts = [...arr(M.accounts), ...arr(M.sharedAccounts)].filter((a) => a && typeof a.id === "string");
  const acc = new Map(accounts.map((a, i) => [a.id, { i: i + 1, type: String(a.type).replace(/[^a-z_]/g, ""), joint: arr(obj(a.use).users).length > 1, a }]));
  const label = (id) => {
    const x = acc.get(id);
    return x ? `account ${x.i} (${x.type}${x.joint ? ", joint" : ""})` : "account ?";
  };
  for (const a of accounts) sec(a.name, a.bankName, a.iban, a.holder, a.cardMask, a.externalId, a.identity, obj(a.bank).name, typeof a.bank === "string" ? a.bank : "");
  for (const u of [M.user, ...arr(M.members)]) sec(obj(u).displayName, obj(u).username, obj(u).email);
  const typeOf = (id) => (acc.get(id) || {}).type;
  const hasParts = accounts.some((a) => a.part && num(a.part.of) && a.part.to - a.part.from < a.part.of);
  const scopes = ["own", ...(arr(M.sharedAccounts).length || hasParts ? ["household"] : [])];

  // ── the rows of the last thirteen months, as the own view counts them ──
  const rows = [];
  let rowsAnswer = null;
  if (kinds.size) {
    const from = `${months[0]}-01`;
    let total = null;
    for (let off = 0; reqs < MAX_REQ; off += PAGE) {
      const r = await get(`/api/transactions${q({ scope: "own", from, to: today, limit: PAGE, offset: off })}`);
      if (r.err) { skip("rows", r.err); break; }
      const v = obj(r.v), items = arr(v.items);
      if (off === 0) rowsAnswer = { total: num(v.total), inCents: num(v.inCents), outCents: num(v.outCents) };
      total = num(v.total);
      for (const i of items) {
        const d = iso(i.bookingDate), c = num(i.amountCents);
        if (!d || c === null || typeof i.accountId !== "string") continue;
        sec(i.counterparty, i.merchant, i.counterpartyIban);
        rows.push({ id: i.id, a: i.accountId, d, c, p: num(i.partCents), k: i.category, t: !!i.isTransfer, pending: i.status === "pending", cp: String(i.counterparty || i.merchant || ""), mer: String(i.merchant || "") });
      }
      if (items.length < PAGE || (total !== null && off + PAGE >= total)) break;
    }
    if (rowsAnswer && rowsAnswer.total !== null && rowsAnswer.total !== rows.length) skip("rows", `the answers held ${rows.length} of ${rowsAnswer.total} rows (the request limit or a bad row)`);
  } else skip("rows", "/api/meta lists no categories");
  const amt = (r) => (r.p !== null ? r.p : r.c);

  /** The flows of a row as the app counts them (packages/core flows.ts), in cents. */
  const flowOf = (r) => {
    const f = { cons: 0, debt: 0, saved: 0, inc: 0, borr: 0 };
    const type = typeOf(r.a), a = amt(r);
    if (type === "loan") return f;
    if (r.t) return type === "savings" ? { ...f, saved: a } : f;
    switch (kinds.get(r.k)) {
      case "expense": f.cons = -a; break;
      case "debt": f.debt = -a; break;
      case "savings": f.saved = -a; break;
      case "income": f.inc = a; break;
      case "transfer": if (r.k === "credit_draw") f.borr = a; break;
    }
    return f;
  };
  /** Totals and the net spending of each category over a range of days, from the rows. */
  const calc = (from, to) => {
    const t = { cons: 0, debt: 0, saved: 0, inc: 0, borr: 0 }, cat = new Map();
    for (const r of rows) {
      if (r.d < from || r.d > to) continue;
      const f = flowOf(r);
      for (const k in t) t[k] += f[k];
      if (f.cons + f.debt) cat.set(r.k, (cat.get(r.k) || 0) + f.cons + f.debt);
    }
    return { t, cat };
  };

  // ── 1. the front page ──
  const dash = new Map(), reps = new Map();
  const reportsFor = async (scope, m) => {
    const key = `${scope}|${m}`;
    if (!reps.has(key)) {
      const r = await get(`/api/reports${q({ from: `${m}-01`, to: m === thisM ? today : lastDay(m), scope })}`);
      reps.set(key, r);
    }
    return reps.get(key);
  };
  const monthRange = (m) => ({ from: `${m}-01`, to: m === thisM ? today : lastDay(m) });
  for (const scope of scopes) {
    for (const m of [thisM, lastM]) {
      const r = await get(`/api/dashboard${q({ ...monthRange(m), scope })}`);
      const where = `dashboard ${scope} ${m}`;
      if (r.err) { skip(1, r.err); continue; }
      const d = obj(r.v), t = obj(d.totals), cats = arr(d.categories);
      dash.set(`${scope}|${m}`, d);
      const rowsSum = sum(cats.map((c) => num(obj(c).cents) || 0));
      const own = scope === "own" && rows.length ? calc(monthRange(m).from, monthRange(m).to) : null;
      const negative = own ? [...own.cat].filter(([, v]) => v < 0).map(([k, v]) => `${catId(k)} ${v}`) : [];
      if (num(t.expenseCents) === null) skip(1, `${where} has no expense total`);
      else {
        tick(1);
        if (rowsSum !== t.expenseCents) fail(1, "1.sum", where, `category rows add up to the spending total ${t.expenseCents}`, `${rowsSum} (diff ${rowsSum - t.expenseCents})${negative.length ? `; net-negative categories left out of the rows: ${negative.slice(0, 6).join(", ")}` : ""}`, rowsSum - t.expenseCents);
      }
      for (const c of cats) {
        tick(1);
        if (num(obj(c).cents) !== null && c.cents < 0) fail(1, "1.neg", where, "no negative category", `${catId(c.category)} ${c.cents}`, c.cents);
      }
      for (const [name, curve] of [["this month", arr(obj(d.pace).current)], ["previous month", arr(obj(obj(d.pace).previous).curve)]]) {
        tick(1);
        const bad = curve.map((v, i) => [v, i + 1]).filter(([v]) => num(v) !== null && v < 0);
        if (bad.length) fail(1, "1.cumulative", where, `the ${name} line stays at or above 0`, `${bad.length} days below 0, the lowest ${Math.min(...bad.map(([v]) => v))}, first on day ${bad[0][1]}`, Math.min(...bad.map(([v]) => v)));
      }
      const rep = await reportsFor(scope, m);
      const income = rep.err ? null : obj(obj(rep.v).income);
      if (rep.err) skip(1, rep.err);
      else if (!arr(income.months).length) skip(1, `${where}: the answer has no income report`);
      else {
        const row = income.months.find((x) => obj(x).month === m);
        if (!row) skip(1, `${m} is not in the income report's months (a running month is left out)`);
        else cmp(1, "1.income", where, num(t.incomeCents), num(row.totalCents));
      }
      if (own && kinds.size) {
        const mine = { incomeCents: own.t.inc, consumptionCents: own.t.cons, debtCents: own.t.debt, savedCents: own.t.saved, borrowedCents: own.t.borr };
        for (const k in mine) if (num(t[k]) !== null) cmp(1, `1.rows-${k.replace("Cents", "")}`, where, mine[k], t[k]);
        const diffs = [...new Set([...own.cat.keys(), ...cats.map((c) => obj(c).category)])]
          .map((k) => [k, Math.max(own.cat.get(k) || 0, 0), num(obj(cats.find((c) => obj(c).category === k)).cents) || 0])
          .filter(([, a, b]) => a !== b).sort((a, b) => Math.abs(b[1] - b[2]) - Math.abs(a[1] - a[2])).slice(0, 5);
        tick(1);
        for (const [k, a, b] of diffs) fail(1, "1.rows-category", `${where} category ${catId(k)}`, `${a} (the rows' net spending)`, b, a - b);
      }
    }
  }
  extra[1] = `scopes ${scopes.join("+")}, months ${lastM} and ${thisM}`;

  // ── 2. month by month, from the rows ──
  if (rows.length) {
    const shares = [];
    for (const m of months) {
      const mr = rows.filter((r) => r.d.startsWith(m));
      const tr = mr.filter((r) => r.t);
      const inn = tr.filter((r) => r.c > 0), out = tr.filter((r) => r.c < 0);
      tick(2);
      if (sum(inn.map((r) => r.c)) !== -sum(out.map((r) => r.c))) {
        const net = new Map();
        for (const r of tr) net.set(r.a, (net.get(r.a) || 0) + r.c);
        const where = [...net].filter(([, v]) => v).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([a, v]) => `${label(a)} ${v}`).join(", ");
        fail(2, "2.transfers", m, "own transfers in equal own transfers out", `in ${inn.length} rows ${sum(inn.map((r) => r.c))}, out ${out.length} rows ${-sum(out.map((r) => r.c))}; net by account: ${where}`, sum(inn.map((r) => r.c)) + sum(out.map((r) => r.c)));
      }
      const spend = mr.filter((r) => !r.t && ["expense", "debt"].includes(kinds.get(r.k)) && amt(r) < 0 && typeOf(r.a) !== "loan");
      const other = sum(spend.filter((r) => r.k === "other").map((r) => -amt(r))), all = sum(spend.map((r) => -amt(r)));
      shares.push(all ? Math.round((100 * other) / all) : 0);
      tick(2);
      if (all && other / all > 0.25) fail(2, "2.uncategorised", m, "at most a quarter of spending is in other", `${Math.round((100 * other) / all)} % (${other} of ${all})`, other);
      for (const [kind, want, name] of [[["expense", "debt"], 1, "incoming rows in a spending category"], [["income"], -1, "outgoing rows in an income category"]]) {
        const by = new Map();
        for (const r of mr) {
          if (r.t || !kind.includes(kinds.get(r.k)) || typeOf(r.a) === "loan" || Math.sign(amt(r)) !== want) continue;
          const e = by.get(r.k) || { n: 0, s: 0 };
          e.n++; e.s += Math.abs(amt(r));
          by.set(r.k, e);
        }
        for (const [k, e] of by) {
          tick(2);
          const rest = sum(mr.filter((r) => r.k === k && !r.t && Math.sign(amt(r)) === -want && typeOf(r.a) !== "loan").map((r) => Math.abs(amt(r))));
          if (e.s > rest / 2) fail(2, want > 0 ? "2.incoming-in-spending" : "2.outgoing-in-income", `${m} category ${catId(k)}`, `${name} stay under half of the other direction (${rest})`, `${e.n} rows, ${e.s}`, e.s - rest);
        }
      }
    }
    extra[2] = `months ${months[0]}..${thisM}; other share of spending % by month: ${shares.join(" ")}`;
    if (rowsAnswer && rowsAnswer.inCents !== null) {
      const own = rows.filter((r) => !r.t);
      cmp(2, "2.rows-in", "transactions answer, whole window", rowsAnswer.inCents, sum(own.filter((r) => amt(r) > 0).map(amt)));
      cmp(2, "2.rows-out", "transactions answer, whole window", rowsAnswer.outCents, -sum(own.filter((r) => amt(r) < 0).map(amt)));
    }
  } else skip(2, "no rows");

  // ── 3. each account ──
  const parts3 = [];
  if (accounts.length && rows.length) {
    const byAcc = new Map(accounts.map((a) => [a.id, rows.filter((r) => r.a === a.id).sort((x, y) => (x.d < y.d ? -1 : 1))]));
    const firsts = [...byAcc.values()].filter((x) => x.length).map((x) => x[0].d.slice(0, 7)).sort();
    for (const a of accounts) {
      const rs = byAcc.get(a.id), name = label(a.id);
      const per = months.map((m) => rs.filter((r) => r.d.startsWith(m)).length);
      const bal = num(a.balanceCents) !== null;
      parts3.push(`${name}: balance ${bal ? "yes" : "no"}, ${rs.length ? `first ${rs[0].d} last ${rs[rs.length - 1].d}` : "no rows"}, rows/month ${per.join(",")}`);
      tick(3, 3);
      if (!rs.length) { fail(3, "3.no-rows", name, `rows in ${months[0]}..${thisM}`, "none"); continue; }
      let worst = null;
      for (let i = 1; i < rs.length; i++) {
        const g = days(rs[i - 1].d, rs[i].d);
        if (g > 20 && (!worst || g > worst.g)) worst = { g, at: rs[i - 1].d.slice(0, 7), n: 0 };
      }
      const gaps = rs.slice(1).filter((r, i) => days(rs[i].d, r.d) > 20).length;
      if (worst) fail(3, "3.gap", name, "bookings at most 20 days apart", `${gaps} gaps, the longest ${worst.g} days after a row in ${worst.at}`);
      const idle = days(rs[rs.length - 1].d, today);
      if (idle > 20) fail(3, "3.stale", name, "a booking in the last 20 days", `last row ${rs[rs.length - 1].d.slice(0, 7)}, ${idle} days ago`);
      const late = firsts.length ? days(`${firsts[0]}-01`, `${rs[0].d.slice(0, 7)}-01`) / 30.44 : 0;
      if (Math.round(late) >= 1) fail(3, "3.short-history", name, `rows from ${firsts[0]} like the other accounts`, `first row ${rs[0].d.slice(0, 7)}, ${Math.round(late)} months with nothing before it`);
    }
    extra[3] = parts3.join(" | ");
  } else skip(3, "no accounts or no rows");

  // ── 4. the same row twice ──
  const PEOPLE = ["p2p", "p2p_in"];
  const payees = new Map(), people = new Set(rows.filter((r) => PEOPLE.includes(r.k)).map((r) => r.mer));
  const payee = (name, cat) => {
    if (!payees.has(name)) payees.set(name, payees.size + 1);
    return `payee #${payees.get(name)} (${people.has(name) || PEOPLE.includes(cat) ? "person" : "company"})`;
  };
  if (rows.length) {
    const groups = new Map();
    for (const r of rows) if (!r.pending) groups.set(`${r.a}|${r.d}|${r.c}|${r.cp}`, [...(groups.get(`${r.a}|${r.d}|${r.c}|${r.cp}`) || []), r]);
    tick(4, groups.size);
    const by = new Map();
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const e = by.get(g[0].a) || { groups: 0, rows: 0, cents: 0, months: new Set(), big: g };
      e.groups++; e.rows += g.length - 1; e.cents += Math.abs(g[0].c) * (g.length - 1); e.months.add(g[0].d.slice(0, 7));
      if (g.length > e.big.length || (g.length === e.big.length && Math.abs(g[0].c) > Math.abs(e.big[0].c))) e.big = g;
      by.set(g[0].a, e);
    }
    for (const [a, e] of by) {
      fail(4, "4.duplicate", label(a), "no row twice (same account, day, amount, payee)", `${e.groups} groups, ${e.rows} extra rows, ${e.cents} in the extra rows, months ${[...e.months].sort().slice(0, 6).join(" ")}; the largest ${payee(e.big[0].mer, e.big[0].k)} ${e.big.length} times ${e.big[0].c} in ${e.big[0].d.slice(0, 7)}`, e.cents);
    }
  } else skip(4, "no rows");

  // ── 5. recurring series and lenders ──
  const spread = (ds) => {
    const s = [...ds].sort((x, y) => x - y);
    return s.length < 2 ? 0 : 30 - Math.max(...s.map((d, i) => (i ? d - s[i - 1] : s[0] + 30 - s[s.length - 1])));
  };
  const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const KINDS = ["subscription", "bill", "habit", "income"];
  for (const scope of scopes) {
    const r = await get(`/api/recurring${q({ scope })}`);
    if (r.err) { skip(5, r.err); continue; }
    for (const s of arr(obj(r.v).series)) {
      const id = typeof s.id === "string" ? /^(in|out):([^:]*):(.+)$/su.exec(s.id) : null;
      const kind = KINDS.includes(s.kind) ? s.kind : "kind?";
      const product = id ? /#(habit|-?[1-9]\d*|0)$/.exec(id[3]) : null;
      const where = `${scope === "own" ? "" : scope + " "}${payee(String(s.merchant), s.category)}, ${kind}${id ? ", " + label(id[2]) : ""}`;
      const nd = iso(s.nextDate), ld = iso(s.lastDate), typical = num(s.typicalAmountCents) || 0;
      if (s.active !== false && nd) {
        tick(5);
        if (nd < today) fail(5, "5.next-past", where, "a next day of today or later", `${days(nd, today)} days ago, ${s.overdue ? "marked" : "not marked"} overdue, last charge in ${(ld || "?").slice(0, 7)}`, typical);
      }
      if (scope !== "own" || !id || kind === "habit" || (product && product[1] === "habit")) continue;
      const rs = rows.filter((x) => x.a === id[2] && x.mer === s.merchant && !x.t && (id[1] === "in" ? x.c > 0 : x.c < 0) && (!product || Math.abs(x.c) === Math.abs(Number(product[1]))));
      if (rs.length < 3) continue;
      tick(5, 2);
      const sp = spread(rs.map((x) => +x.d.slice(8, 10)));
      if (nd && ld && sp > 5 && Math.abs(days(ld, nd) - (num(s.intervalDays) || 0)) <= 1) fail(5, "5.next-by-interval", where, "a next day that follows the day of the month", `last day plus ${days(ld, nd)} days, while the day of the month varies by ${sp} days over ${rs.length} charges`, typical);
      const am = rs.map((x) => Math.abs(x.c)), lo = Math.min(...am), hi = Math.max(...am);
      if (kind === "subscription" && hi - lo > median(am) / 5) fail(5, "5.amounts", where, "a subscription's amounts within a fifth", `${lo} to ${hi}, median ${median(am)}, over ${rs.length} charges`, hi - lo);
    }
  }
  const proposals = await get("/api/loans/proposals"), saved = await get("/api/loans");
  if (proposals.err) skip(5, proposals.err);
  else
    for (const p of arr(obj(proposals.v).proposals)) {
      tick(5);
      fail(5, "5.lender", payee(String(p.payee), ""), "a loan saved in the settings", `proposed as a ${String(p.kind).replace(/[^a-z_]/g, "")} loan: ${num(p.months)} months, payment ${num(p.paymentCents)}`, num(p.paymentCents) || 0);
    }
  extra[5] = `${saved.err ? "loans unread" : arr(obj(saved.v).loans).length + " loans saved"}`;

  // ── 6. joint accounts ──
  const joints = accounts.filter((a) => acc.get(a.id).joint);
  if (!joints.length) extra[6] = "no joint account";
  for (const a of joints) {
    const rs = rows.filter((r) => r.a === a.id && !r.t), part = obj(a.part), share = num(part.of) ? (part.to - part.from) / part.of : null;
    const by = new Map();
    for (const r of rs) {
      const e = by.get(r.k) || { n: 0, whole: 0, part: 0 };
      e.n++; e.whole += r.c; e.part += amt(r);
      by.set(r.k, e);
    }
    if (share !== null && share < 1) {
      tick(6, by.size + 1);
      const bare = rs.filter((r) => r.p === null).length;
      if (bare) fail(6, "6.no-part", label(a.id), "every row with the viewer's part", `${bare} of ${rs.length} rows have none`, 0);
      for (const [k, e] of by) if (Math.abs(e.part - e.whole * share) > e.n + 1) fail(6, "6.part", `${label(a.id)} category ${catId(k)}`, `${Math.round(share * 100)} % of ${e.whole} = ${Math.round(e.whole * share)}`, `${e.part} over ${e.n} rows`, e.part - e.whole * share);
    }
    extra[6] = [extra[6], `${label(a.id)} part ${share === null ? "unknown" : Math.round(share * 100) + " %"}, whole/part by category: ${[...by].sort((x, y) => Math.abs(y[1].whole) - Math.abs(x[1].whole)).slice(0, 4).map(([k, e]) => `${catId(k)} ${e.whole}/${e.part}`).join(", ")}`].filter(Boolean).join(" | ");
    for (const k of ["p2p", "gambling"]) {
      const out = rs.filter((r) => r.k === k && r.c < 0);
      if (out.length) fail(6, "6.sensitive", label(a.id), "no payment to persons or gambling", `${catId(k)}: ${out.length} rows, whole ${-sum(out.map((r) => r.c))}, at the viewer's part ${-sum(out.map(amt))}`, sum(out.map((r) => r.c)));
    }
  }

  // ── 7. the reports against the front page and the rows ──
  const R7 = new Map();
  for (const scope of scopes) {
    for (const m of [thisM, lastM]) {
      const d = dash.get(`${scope}|${m}`), rep = reps.get(`${scope}|${m}`);
      if (!d || !rep || rep.err) continue;
      const R = obj(rep.v), t = obj(d.totals), where = `reports ${scope} ${m}`, cats = arr(d.categories);
      R7.set(`${scope}|${m}`, R);
      const catSum = sum(cats.map((c) => num(obj(c).cents) || 0));
      const has = (name) => (R[name] ? true : (skip(7, `${where} has no ${name} report`), false));
      if (has("summary")) for (const [a, b] of [["incomeCents", "incomeCents"], ["spendingCents", "expenseCents"], ["savedCents", "savedCents"], ["netCents", "netCents"]]) cmp(7, "7.summary", `${where} ${a}`, num(t[b]), num(R.summary[a]));
      if (has("cashflow")) {
        const cf = obj(R.cashflow);
        for (const k of ["incomeCents", "consumptionCents", "debtCents", "savedCents", "borrowedCents", "netCents", "leftCents"]) if (num(t[k]) !== null) cmp(7, "7.cashflow", `${where} totals ${k}`, t[k], num(obj(cf.totals)[k]));
        const row = arr(cf.rows).find((x) => obj(x).month === m);
        if (row) for (const k of ["incomeCents", "consumptionCents", "debtCents", "savedCents"]) cmp(7, "7.cashflow-month", `${where} ${k}`, num(t[k]), num(row[k]));
      }
      if (has("categories")) {
        const c = obj(R.categories), listed = arr(c.groups).flatMap((g) => arr(obj(g).categories));
        cmp(7, "7.categories-total", where, catSum, num(c.totalCents));
        cmp(7, "7.categories-groups", where, num(c.totalCents), sum(arr(c.groups).map((g) => num(obj(g).totalCents) || 0)));
        cmp(7, "7.categories-income", where, num(t.incomeCents), num(c.incomeCents));
        for (const x of cats) cmp(7, "7.category", `${where} category ${catId(obj(x).category)}`, num(x.cents), num(obj(listed.find((y) => obj(y).category === x.category)).totalCents));
      }
      if (has("pivot")) {
        const p = obj(R.pivot);
        cmp(7, "7.pivot-total", where, catSum, num(p.totalCents));
        cmp(7, "7.pivot-rows", where, num(p.totalCents), sum(arr(p.rows).map((x) => num(obj(x).totalCents) || 0)));
        cmp(7, "7.pivot-months", where, num(p.totalCents), sum(arr(p.monthTotals).map((x) => num(x) || 0)));
      }
      if (has("fixedVariable")) {
        const f = obj(R.fixedVariable.totals);
        cmp(7, "7.fixed-variable", where, num(t.expenseCents), sum(["fixedCents", "habitCents", "variableCents", "debtCents"].map((k) => num(f[k]) || 0)));
      }
    }
  }
  const top = arr(obj(dash.get(`own|${lastM}`)).categories).filter((c) => num(obj(c).cents) !== null).slice(0, 3);
  for (const c of top) {
    if (reqs >= 34) { skip(7, "the request limit came near before the category sums"); break; }
    const r = await get(`/api/transactions${q({ scope: "own", ...monthRange(lastM), category: c.category, limit: 1 })}`);
    if (r.err) { skip(7, r.err); break; }
    cmp(7, "7.transactions", `own ${lastM} category ${catId(c.category)}`, c.cents, num(obj(r.v).outCents) - num(obj(r.v).inCents));
  }
  if (reqs < 34) {
    const mer = await get(`/api/merchants${q({ scope: "own", ...monthRange(lastM), limit: 200 })}`), all = await get(`/api/transactions${q({ scope: "own", ...monthRange(lastM), limit: 1 })}`);
    const items = arr(obj(mer.v).items);
    if (mer.err || all.err) skip(7, mer.err || all.err);
    else if (items.length >= 200) skip(7, `the merchant list of ${lastM} was cut at 200`);
    else cmp(7, "7.merchants-out", `own ${lastM} merchant list`, num(obj(all.v).outCents), sum(items.map((x) => num(obj(x).totalCents) || 0)));
  }

  // ── 8. what the household holds ──
  const here = obj(dash.get(`own|${thisM}`)), h = obj(here.holdings), held = arr(h.accounts);
  if (!dash.has(`own|${thisM}`)) skip(8, "no dashboard answer");
  else if (!here.holdings) skip(8, "the dashboard has no holdings (an older version)");
  else {
    const known = held.filter((a) => num(obj(a).balanceCents) !== null);
    cmp(8, "8.accounts-sum", "holdings", known.length ? sum(known.map((a) => a.balanceCents)) : null, num(h.accountsCents));
    const series = arr(obj(obj(R7.get(`own|${thisM}`)).balances).accounts);
    for (const a of held) {
      const s = series.find((x) => obj(x).accountId === a.id), last = s && arr(s.values).length ? arr(s.values)[arr(s.values).length - 1] : undefined;
      if (last !== undefined) cmp(8, "8.balance-series", label(a.id), num(a.balanceCents), num(last));
      const own = acc.get(a.id);
      if (own && !a.part) cmp(8, "8.balance-meta", label(a.id), num(own.a.balanceCents), num(a.balanceCents));
    }
    cmp(8, "8.holdings-twice", "balances report against the front page", num(h.accountsCents), num(obj(obj(obj(R7.get(`own|${thisM}`)).balances).holdings).accountsCents));
  }
  for (const a of accounts) {
    const x = acc.get(a.id);
    if (x.type === "credit_card") {
      tick(8);
      const limit = num(a.creditLimitCents) !== null ? a.creditLimitCents : num(obj(arr(h.cards).find((c) => obj(c).id === a.id)).limitCents);
      if (limit === null) fail(8, "8.card-limit", label(a.id), "a credit limit", `none${num(a.balanceCents) === null ? ", no balance either" : ", balance " + a.balanceCents}`, Math.abs(num(a.balanceCents) || 0));
    }
    if (x.type === "other" || x.type === "loan") {
      tick(8);
      fail(8, "8.type", label(a.id), "checking, savings or credit_card", `typed ${x.type}, balance ${num(a.balanceCents) === null ? "unknown" : a.balanceCents}, ${rows.filter((r) => r.a === a.id).length} rows in the window`, Math.abs(num(a.balanceCents) || 0));
    }
  }

  // ── 3 again: the first day of each account in all its history ──
  const before = new Date(stamp(`${months[0]}-01`) - 864e5).toISOString().slice(0, 10), firsts = [];
  for (const a of accounts.slice(0, 6)) {
    if (reqs >= MAX_REQ - 2) break;
    const r1 = await get(`/api/transactions${q({ scope: "own", accountId: a.id, to: before, limit: 1 })}`), n = num(obj(r1.v).total);
    if (r1.err || !n) continue;
    const r2 = await get(`/api/transactions${q({ scope: "own", accountId: a.id, to: before, limit: 1, offset: n - 1 })}`);
    const d = iso(obj(arr(obj(r2.v).items)[0]).bookingDate);
    if (d) firsts.push(`${label(a.id)} ${d}`);
  }
  if (firsts.length) extra[3] = `${extra[3] || ""}${extra[3] ? " | " : ""}first booking day before ${months[0]}: ${firsts.join(", ")}`;

  // ── the answer ──
  const version = String(obj(M.version).app || "").replace(/[^0-9a-z.+-]/gi, "").slice(0, 20);
  const shape = (list, cut) => JSON.stringify({ version, requests: reqs, today, failures: list, more: cut, checks: verdict() });
  fails.sort((a, b) => b.m - a.m);
  const list = fails.slice(0, MAX_FAIL).map(({ m, ...f }) => f);
  let cut = fails.length - list.length, out = shape(list, cut);
  while (out.length > LIMIT && list.length > 1) { list.pop(); cut++; out = shape(list, cut); }
  if (out.length > LIMIT) out = out.slice(0, LIMIT - 12) + '..."cut"}';
  const WORDS = /^(checking|savings|credit_card|loan|other|joint|account|payee|person|company)$/i;
  for (const s of secret) {
    if (WORDS.test(s) || /^#+$/.test(s)) continue;
    for (let at = out.toLowerCase().indexOf(s); at >= 0; at = out.toLowerCase().indexOf(s, at)) out = out.slice(0, at) + "#".repeat(s.length) + out.slice(at + s.length);
  }
  return out;
})()
