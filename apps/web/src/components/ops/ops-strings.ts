import { language } from "../../format.ts";
import { labelTable, t, tn } from "../../text.ts";
import project from "../../../../../project.json";
import type { HelperInfo, OpsAction, OpsRequestView, OpsSnapshot, RestoreCopy, RestoreState } from "./types.ts";

/** Finnish wording of Asetukset > Ylläpito in one place, so it is read through once. */
export const ENABLE_DOC = `https://github.com/${project.owner}/${project.repo}/blob/main/docs/ADVANCED.md#the-maintenance-helper`;
const ROLLBACK_HELP = "./scripts/update.sh --rollback";
/** Run in the install folder when the app does not come back after a restore request (docker-compose.yml restarts it with `restart: unless-stopped`). */
export const START_HELP = "docker compose up -d";

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
  get backups() {
    return t("ops.backups");
  },
  get backupNow() {
    return t("ops.backup_now");
  },
  get downloadNewest() {
    return t("ops.download_newest");
  },
  get downloadTitle() {
    return t("ops.download_title");
  },
  get downloadBody() {
    return t("ops.download_body");
  },
  get keyNote() {
    return t("ops.key_note");
  },
  get noBackups() {
    return t("ops.no_backups");
  },
  get doctor() {
    return t("ops.doctor");
  },
  get runDoctor() {
    return t("ops.run_doctor");
  },
  checkedAt: (time: string) => t("ops.checked_at", { time }),
  get actionNames() {
    return { "check-update": t("ops.action_check_update"), update: t("ops.action_update"), rollback: t("ops.action_rollback") };
  },
  get neverRun() {
    return t("ops.never_run");
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

  // Palauta, a row of Varmuuskopiot. The sentences of the server (the 400, 403, 409 and 503 answers) are shown as they come.
  get restoreRow() {
    return t("ops.restore_row");
  },
  get restoreTitle() {
    return t("ops.restore_title");
  },
  get restoreSubmit() {
    return t("ops.restore_submit");
  },
  restoreWord: "PALAUTA",
  get restorePending() {
    return t("ops.restore_pending");
  },
  get restoreLoses() {
    return t("ops.restore_loses");
  },
  get restoreMistake() {
    return t("ops.restore_mistake");
  },
  get restoreUndoesReset() {
    return t("ops.restore_undoes_reset");
  },
  restoreDialog: (time: string) => [t("ops.restore_dialog_replaced", { time }), t("ops.restore_dialog_lost"), t("ops.restore_dialog_restart")],
  restoreAsked: (time: string) => t("ops.restore_asked", { time }),
  get restoreWaiting() {
    return t("ops.restore_waiting");
  },
  get restoreSlow() {
    return t("ops.restore_slow", { command: START_HELP });
  },
  get restoreLate() {
    return t("ops.restore_late");
  },
  get restoreBack() {
    return t("ops.restore_back");
  },
  get restoreStillPending() {
    return t("ops.restore_still_pending");
  },
  get reload() {
    return t("ops.reload");
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

/** The restore request lapses 15 minutes after it was made (db/startup-gate.ts MARKER_MAX_AGE_MS). */
export const REQUEST_LAPSES_MS = 15 * 60_000;
/** After this long without an answer from /api/health the card says what to do. */
export const SLOW_MS = 60_000;

/** The only two fields either request carries. The server refuses any other. */
export const confirmBody = (password: string, confirm: string): { password: string; confirm: string } => ({ password, confirm });

/** The copy whose row offers "Palauta": the one the server would take, unless a request already waits or none is read yet. */
export function restorable(state: RestoreState | null): RestoreCopy | null {
  return state && !state.pending ? state.copy : null;
}

/** What the card says while it waits for the app to answer again after the request. */
export function restoreWait(waitedMs: number): string[] {
  if (waitedMs < SLOW_MS) return [S.restoreWaiting];
  return waitedMs < REQUEST_LAPSES_MS ? [S.restoreSlow] : [S.restoreSlow, S.restoreLate];
}

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
const KIND: Record<string, string> = labelTable({ daily: () => t("ops.kind_daily"), "pre-update": () => t("ops.kind_pre_update"), "pre-reset": () => t("ops.kind_pre_reset"), manual: () => t("ops.kind_manual") });
/** What the list calls a copy. The server says what a copy is (db/backup-keep.ts copyKind); the page only words it. */
export const kindLabel = (kind: string): string => KIND[kind] ?? kind;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return t("ops.size_bytes", { n: bytes });
  if (bytes < 1024 * 1024) return t("ops.size_kb", { n: Math.round(bytes / 1024) });
  return t("ops.size_mb", { n: (bytes / 1024 / 1024).toFixed(1).replace(".", language() === "fi" ? "," : ".") });
}
