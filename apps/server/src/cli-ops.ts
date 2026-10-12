/**
 * The host helper's side of the maintenance channel, run as
 *   docker compose exec -T banking node dist/node.js ops poll --helper <ver> --done <id,id>
 *   docker compose exec -T banking node dist/node.js ops report [--helper <ver>]   (JSON on stdin)
 *   docker compose exec -T banking node dist/node.js ops state [--helper <ver>]    (JSON on stdin)
 *   docker compose exec -T banking node dist/node.js ops access --helper <ver>
 * Each prints one JSON object on stdout and exits 0 unless the database is unreachable. Secrets and
 * results go through stdin and stdout, never argv.
 *
 * `ops access` prints the change of remote access the app has prepared (services/access-request.ts), with the keys in
 * this order: {"want":"tunnel","hostname","tunnelToken","accessAud","teamDomain"}, {"want":"lan"} or {"want":null}.
 * The helper matches the line as text and checks every value again.
 */
import { option } from "./cli-args.ts";
import { readAccessRequest } from "./services/access-request.ts";
import type { Services } from "./services/context.ts";
import { UserError } from "./platform/errors.ts";
import { pollOps, reportOps, stateOps } from "./services/ops.ts";
import { helperKnows } from "./services/ops-validate.ts";
import { settleRemoteAccess } from "./services/remote-access.ts";

// the logs action sends up to 48 KiB of text, which JSON escaping can grow
const MAX_STDIN = 160 * 1024;

export async function runOpsCli(s: Services, args: string[], readStdin: () => Promise<string>): Promise<number> {
  const print = (v: unknown) => console.log(JSON.stringify(v));
  const [sub] = args;
  const helper = option(args, "--helper");
  try {
    if (sub === "poll") {
      const done = (option(args, "--done") ?? "").split(",").filter(Boolean);
      print({ request: await pollOps(s, { helper, done }) });
      return 0;
    }
    if (sub === "access") {
      // only for a helper that knows the action; an older one has no use for the tunnel token
      print((helperKnows(helper, "access") ? readAccessRequest(s) : null) ?? { want: null });
      return 0;
    }
    if (sub === "report" || sub === "state") {
      const text = await readStdin();
      if (text.length > MAX_STDIN) throw new UserError("Syöte on liian pitkä.");
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new UserError("Syöte ei ole kelvollista JSONia.");
      }
      if (sub === "report") {
        await reportOps(s, payload, helper);
        // a remote access change ends here: its request file (the tunnel token) goes now and not at the next page load
        await settleRemoteAccess(s).catch((err) => console.error("settling remote access failed:", err));
      }
      else await stateOps(s, payload, helper);
      print({ ok: true });
      return 0;
    }
  } catch (err) {
    // bad input from the helper is reported in the JSON and does not make it retry for ever
    if (err instanceof UserError) {
      print({ ok: false, error: err.message });
      return 0;
    }
    throw err;
  }
  console.error("Usage: ops poll --helper <version> --done <ids> | ops report | ops state | ops access --helper <version>");
  return 1;
}
