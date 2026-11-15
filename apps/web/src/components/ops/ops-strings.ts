import { labelTable, t, tn } from "../../text.ts";
import project from "../../../../../project.json";
import type { HelperInfo, OpsAction, OpsRequestView, OpsSnapshot } from "./types.ts";

/** Finnish wording of Asetukset > Ylläpito in one place, so it is read through once. */
export const ENABLE_DOC = `https://github.com/${project.owner}/${project.repo}/blob/main/docs/ADVANCED.md#the-maintenance-helper`;
const ROLLBACK_HELP = "./scripts/update.sh --rollback";

export const S = {
  get title() {
    return t("ops.title");
  },
  helperOk: (time: string) => t("ops.helper_ok", { time }),
  helperSlow: (time: string) => t("ops.helper_slow", { time }),
  get helperNever() {
    return t("ops.helper_never");
  },
  get helperNeverHelp() {
    return t("ops.helper_never_help");
  },
  get helperStale() {
    return t("ops.helper_stale");
  },
  get helperOutdated() {
    return t("ops.helper_outdated");
  },
  get helperDoc() {
    return t("ops.helper_doc");
  },
  get version() {
    return t("ops.version");
  },
  get checkUpdates() {
    return t("ops.check_updates");
  },
  get needsHelper() {
    return t("ops.needs_helper");
  },
  upToDate: (time: string) => t("ops.up_to_date", { time }),
  /** The host's update channel as the helper reports it; switched only on the server (scripts/use-private.sh). */
  channel: (c: "source" | "release" | "private") => t(c === "private" ? "ops.channel_private" : c === "source" ? "ops.channel_source" : "ops.channel_public"),
  updateAvailable: (version?: string) => (version ? t("ops.update_available_version", { version }) : t("ops.update_available")),
  get changes() {
    return t("ops.changes");
  },
  get update() {
    return t("ops.update");
  },
  get prerelease() {
    return t("ops.prerelease");
  },
  get prereleaseHelp() {
    return t("ops.prerelease_help");
  },
  get updateTitle() {
    return t("ops.update_title");
  },
  updateTo: (version?: string) => (version ? t("ops.updating_to", { version }) : null),
  get updateBody() {
    return [t("ops.update_body_copy"), t("ops.update_body_restart"), t("ops.update_body_previous")];
  },
  get rollback() {
    return t("ops.rollback");
  },
  get rollbackTitle() {
    return t("ops.rollback_title");
  },
  get rollbackBody() {
    return t("ops.rollback_body");
  },
  get rollbackSchema() {
    return t("ops.rollback_schema");
  },
  rollbackConfirm: (word: string) => t("ops.rollback_confirm", { word }),
  get password() {
    return t("ops.password");
  },
  get cancel() {
    return t("ops.cancel");
  },
  get working() {
    return t("ops.working");
  },
  get queued() {
    return t("ops.queued");
  },
  get queuedWake() {
    return t("ops.queued_wake");
  },
  queuedNext: (time: string) => t("ops.queued_next", { time }),
  waited: (time: string) => t("ops.waited", { time }),
  runningFor: (time: string) => t("ops.running_for", { time }),
  took: (time: string) => t("ops.took", { time }),
  stepNo: (n: number, m: number) => t("ops.step_no", { n, m }),
  get restarting() {
    return t("ops.restarting");
  },
  get restartingLong() {
    return t("ops.restarting_long", { command: ROLLBACK_HELP });
  },
  get cancelRequest() {
    return t("ops.cancel_request");
  },
  get ok() {
    return t("ops.ok");
  },
  get failed() {
    return t("ops.failed");
  },
  get expired() {
    return t("ops.expired");
  },
  get cancelled() {
    return t("ops.cancelled");
  },
  get showLog() {
    return t("ops.show_log");
  },
  get hideLog() {
    return t("ops.hide_log");
  },
  get noLog() {
    return t("ops.no_log");
  },
  get doctor() {
    return t("ops.doctor");
  },
  get runDoctor() {
    return t("ops.run_doctor");
  },
  checkedAt: (time: string) => t("ops.checked_at", { time }),
  get doctorStale() {
    return t("ops.doctor_stale");
  },
  get doctorFlagged() {
    return t("ops.doctor_flagged");
  },
  get technical() {
    return t("ops.technical");
  },
  get actionNames() {
    return { "check-update": t("ops.action_check_update"), update: t("ops.action_update"), rollback: t("ops.action_rollback") };
  },
  lastAt: (time: string) => t("ops.last_at", { time }),
  lastRunning: (time: string) => t("ops.last_running", { time }),
  get restart() {
    return t("ops.restart");
  },
  get restartHelp() {
    return t("ops.restart_help");
  },
  get events() {
    return t("ops.events");
  },
  get noEvents() {
    return t("ops.no_events");
  },
  get busy() {
    return t("ops.busy");
  },
  get tools() {
    return t("ops.tools");
  },
  get logs() {
    return t("ops.logs");
  },
  get logsHelp() {
    return t("ops.logs_help");
  },
  get prune() {
    return t("ops.prune");
  },
  get pruneHelp() {
    return t("ops.prune_help");
  },
  get renew() {
    return t("ops.renew");
  },
  get renewHelp() {
    return t("ops.renew_help");
  },
  get toolsOutdated() {
    return t("ops.tools_outdated");
  },

  // Tyhjennä kaikki tiedot
  get resetSub() {
    return t("ops.reset_sub");
  },
  get resetTitle() {
    return t("ops.reset_title");
  },
  get resetSubmit() {
    return t("ops.reset_submit");
  },
  resetWord: "TYHJENNÄ",
  // the card's three lines: what goes, the copy that is taken first and for how long it brings the data back, and the banks
  get resetLines() {
    return [t("ops.reset_line_removes"), t("ops.reset_line_copy"), t("ops.reset_line_banks")];
  },
  get resetDialog() {
    return [t("ops.reset_dialog_removes"), t("ops.reset_dialog_copy"), t("ops.reset_dialog_signout")];
  },
  resetCopy: (name: string) => t("ops.reset_copy", { name }),
  resetFailed: (n: number) => tn(n, "ops.reset_failed_one", "ops.reset_failed_many"),
  get resetBanks() {
    return t("ops.reset_banks");
  },
  get signIn() {
    return t("ops.sign_in");
  },
};

/** The only two fields either request carries. The server refuses any other. */
export const confirmBody = (password: string, confirm: string): { password: string; confirm: string } => ({ password, confirm });
/**
 * The switch for new versions is on the page when the helper is on, knows the two requests and has said where the
 * switch stands, and the install follows releases (a source install has none to follow).
 */
export function showsPrerelease(helper: HelperInfo, state: OpsSnapshot): boolean {
  return helper.status !== "off" && helper.knowsPrerelease && state.channel !== "source" && state.channel !== "private" && state.prerelease !== undefined;
}
/** Where the switch stands: what a request under way asks for, else what the helper last reported from the host. */
export function prereleaseOn(state: OpsSnapshot, latest: OpsRequestView | undefined): boolean {
  const asked = latest && (latest.status === "queued" || latest.status === "running") ? latest.action : "";
  if (asked === "prerelease-on" || asked === "prerelease-off") return asked === "prerelease-on";
  return state.prerelease === "yes";
}
/** The request a turn of the switch sends. The position is in the name, and no value goes with it. */
export const prereleaseAction = (on: boolean): OpsAction => (on ? "prerelease-on" : "prerelease-off");

export const LEVEL: Record<string, string> = labelTable({ ok: () => t("ops.level_ok"), warn: () => t("ops.level_warn"), error: () => t("ops.level_error") });
