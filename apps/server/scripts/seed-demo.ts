/**
 * Loads demo data for local development: pnpm seed:demo [username]
 * Without users it creates "demo" (admin) with a printed password.
 */
import { join } from "node:path";
import { loadConfig } from "../src/platform/config.ts";
import { openDatabase } from "../src/db/open.ts";
import { loadDemoData } from "../src/demo.ts";
import { createServices } from "../src/services/context.ts";
import { createUser } from "../src/services/users.ts";

const path = process.env.DB_PATH ?? join(process.env.DATA_DIR ?? "./data", "banking.db");
const { db } = await openDatabase(path);
const s = createServices({ db, config: loadConfig(process.env) });

const wanted = process.argv[2];
let user = wanted ? await s.users.findForLogin(wanted) : (await s.users.list()).find((u) => u.role === "admin") ?? null;
if (!user && !wanted && (await s.users.count()) === 0) {
  const password = "demo-salasana-123";
  user = (await createUser(s, { username: "demo", displayName: "Demo", role: "admin", password })).user;
  console.log(`created user "demo" / ${password}`);
}
if (!user) {
  console.error(`user ${wanted} not found`);
  process.exit(1);
}
const r = await loadDemoData(s.finance(user.id), s.settings, s.today());
console.log(`demo data for ${user.username}: ${r.accounts} accounts, ${r.transactions} transactions → ${path}`);
db.close();
