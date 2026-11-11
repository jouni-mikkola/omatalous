/**
 * The English catalogue, kept out of messages.ts so that the browser can load it only for a member who reads English
 * (apps/web/src/language.ts). The server and the tests import it for its side effect: it installs the table.
 * Decision: an English reader sees English from the first paint and a Finnish reader never downloads it.
 */
import { EN_ALERTS } from "./english/alerts.ts";
import { EN_CALC } from "./english/calc.ts";
import { EN_FORECAST } from "./english/forecast.ts";
import { EN_PRICES } from "./english/prices.ts";
import { EN_OPTIMISE } from "./english/optimise.ts";
import { EN_OPTIMISE_A } from "./english/optimise-a.ts";
import { EN_OPTIMISE_B } from "./english/optimise-b.ts";
import { EN_INCOME } from "./english/income.ts";
import { EN_INSIGHTS } from "./english/insights.ts";
import { EN_SHEETS } from "./english/sheets.ts";
import { EN_OFFSITE } from "./english/offsite.ts";
import { EN_PASSKEY } from "./english/passkey.ts";
import { EN_BILLS } from "./english/bills.ts";
import { EN_BANK_FILE } from "./english/bank-file.ts";
import { EN_CARD_FILE } from "./english/card-file.ts";
import { EN_OVERVIEW } from "./english/overview.ts";
import { EN_REPORTS_1 } from "./english/reports-1.ts";
import { EN_REPORTS_2 } from "./english/reports-2.ts";
import { EN_REPORTS_3 } from "./english/reports-3.ts";
import { EN_REPORTS_4 } from "./english/reports-4.ts";
import { EN_REPORTS_5 } from "./english/reports-5.ts";
import { EN_SET_BANK_APP } from "./english/set-bank-app.ts";
import { EN_SET_SECURITY } from "./english/set-security.ts";
import { EN_SET_CONNECTIONS } from "./english/set-connections.ts";
import { EN_SET_MEMBERS } from "./english/set-members.ts";
import { EN_SET_IMPORT } from "./english/set-import.ts";
import { EN_SET_ACCOUNTS } from "./english/set-accounts.ts";
import { EN_SET_FACTOR } from "./english/set-factor.ts";
import { EN_SET_SPLIT } from "./english/set-split.ts";
import { EN_SET_BANK_KEY } from "./english/set-bank-key.ts";
import { EN_SET_LOANS } from "./english/set-loans.ts";
import { EN_SET_RA_MODEL } from "./english/set-ra-model.ts";
import { EN_SET_RECONCILE } from "./english/set-reconcile.ts";
import { EN_SET_SYNC } from "./english/set-sync.ts";
import { EN_SET_TRIAL } from "./english/set-trial.ts";
import { EN_SET_ASK } from "./english/set-ask.ts";
import { EN_SET_REMOTE } from "./english/set-remote.ts";
import { EN_SET_RFORM } from "./english/set-rform.ts";
import { EN_SET_GUIDE } from "./english/set-guide.ts";
import { EN_SET_RSTATUS } from "./english/set-rstatus.ts";
import { EN_SET_RTOKEN } from "./english/set-rtoken.ts";
import { EN_SET_USE_TS } from "./english/set-use-ts.ts";
import { EN_SET_ACUSE } from "./english/set-acuse.ts";
import { EN_SET_NOTICES } from "./english/set-notices.ts";
import { EN_SET_IFORM } from "./english/set-iform.ts";
import { EN_SET_STATUS } from "./english/set-status.ts";
import { EN_SET_OPS } from "./english/set-ops.ts";
import { EN_SET_ASH } from "./english/set-ash.ts";
import { EN_SET_BANKS } from "./english/set-banks.ts";
import { EN_SET_BAPP } from "./english/set-bapp.ts";
import { EN_SET_BRT } from "./english/set-brt.ts";
import { EN_SET_CV } from "./english/set-cv.ts";
import { EN_SET_DPAGE } from "./english/set-dpage.ts";
import { EN_SET_DX } from "./english/set-dx.ts";
import { EN_SET_FR } from "./english/set-fr.ts";
import { EN_SET_MT } from "./english/set-mt.ts";
import { EN_SET_REC } from "./english/set-rec.ts";
import { EN_SET_RR } from "./english/set-rr.ts";
import { EN_SET_SV } from "./english/set-sv.ts";
import { EN_SET_TABS } from "./english/set-tabs.ts";
import { EN_SET_RI } from "./english/set-ri.ts";
import { EN_SET_RV } from "./english/set-rv.ts";
import { EN_SET_RC } from "./english/set-rc.ts";
import { EN_SHELL } from "./english/shell.ts";
import { EN_TABLES } from "./english/tables.ts";
import { EN_TRANSACTIONS } from "./english/transactions.ts";
import { type BaseCodes, installEnglish } from "./messages.ts";

const EN: Record<BaseCodes, string> = {
  // the app's own answers
  "app.error": "Something went wrong. Try again.",
  "app.too_large": "The request is too large.",
  "app.not_found": "Not found.",
  "app.bad_request": "Invalid request. Reload the page.",
  "app.unreachable": "Cannot reach the server. Try again in a moment.",
  "app.server_status": "The server did not answer correctly. Try again in a moment.",
  "app.request_failed": "We could not make the request. Try again.",
  "app.admin_only": "For the administrator only.",
  // sign-in
  "auth.bad_login": "Wrong username or password.",
  "auth.too_many": "Too many attempts. Try again in {minutes} minutes.",
  "auth.busy": "The server is busy. Try again in a moment.",
  "auth.half_expired": "The sign-in expired. Sign in again.",
  "auth.bad_code": "The code is wrong.",
  "auth.login_required": "Sign in.",
  "auth.change_password_first": "Change the temporary password first.",
  "auth.new_password_missing": "Enter a new password.",
  "auth.password_wrong": "The password is wrong.",
  "auth.current_password_wrong": "The current password is wrong.",
  "auth.first_password_not_due": "Your password is not a temporary one.",
  "auth.first_password_expired": "It has been over 10 minutes since you signed in. Sign in again with the temporary password.",
  "auth.use_first_password": "Set the first password on the page that opens after signing in.",
  "auth.password_unchanged": "The new password cannot be the same as the old one.",
  "auth.setup_done": "The app is already set up.",
  "auth.setup_code_expired": "The setup code has expired. Get a new one with docker compose exec banking node dist/node.js setup-code",
  "auth.setup_code_wrong": "Wrong setup code. Get a new one with docker compose exec banking node dist/node.js setup-code",
  "auth.username_shape": "A username needs 3–32 characters (a–z, 0–9, . _ -).",
  "auth.username_taken": "The username is already taken.",
  "auth.token_bad": "The service token is not valid.",
  "auth.token_read_only": "A service token can only read.",
  "auth.token_too_many": "Too many attempts. Try again later.",
  "pw.too_short": "The password needs at least {min} characters.",
  "pw.too_long": "The password is too long.",
  "pw.common": "The password is too common: it is one of the first ones tried.",
  "pw.few_chars": "The password has too few different characters.",
  "pw.repeated": "The password is one short piece repeated.",
  "pw.sequence": "The password is only a run of keys on the keyboard, letters or digits.",
  // users
  "user.missing": "The user was not found.",
  "user.last_admin_role": "You cannot remove the administrator role from the last administrator.",
  "user.delete_self": "You cannot delete your own account.",
  "user.delete_last_admin": "The last administrator cannot be deleted.",
  // validation
  "check.address": "Enter the address like https://talous.oma.fi (no path).",
  "check.timezone": "Unknown time zone.",
  "check.sync_count": "Choose at most {max} fetch times.",
  "check.sync_hour": "A fetch time is a whole hour, 0–23.",
  "check.history_days": "The history is {min}–{max} days long.",
  "check.flag": "The value must be on or off.",
  "check.date_range": "Invalid period.",
  "check.date": "Invalid date.",
  "check.loan": "Unknown loan.",
  "check.body_shape": "The request body has the wrong shape.",
  "check.field": "Unknown field: {name}",
  "check.field_bad": "Invalid field.",
  "check.report": "Unknown report.",
  "check.number": "Invalid number.",
  "check.notice_address": "Enter an https address (like https://example.com/hook) or an ntfy topic (letters, digits, - and _) for the notices.",
  "check.notice_token": "A token is at most 300 characters with no spaces.",
  "check.notice_needs_address": "Enter an address before you turn the notices on.",
  "check.language": "Unknown language.",
  "check.json": "The request body is not valid JSON.",
};

installEnglish({ ...EN, ...EN_SHELL, ...EN_PASSKEY, ...EN_OVERVIEW, ...EN_BILLS, ...EN_TRANSACTIONS, ...EN_TABLES, ...EN_OFFSITE, ...EN_FORECAST, ...EN_SHEETS, ...EN_REPORTS_1, ...EN_REPORTS_2, ...EN_REPORTS_3, ...EN_REPORTS_4, ...EN_REPORTS_5, ...EN_CALC, ...EN_INSIGHTS, ...EN_ALERTS, ...EN_OPTIMISE, ...EN_OPTIMISE_A, ...EN_OPTIMISE_B, ...EN_INCOME, ...EN_PRICES, ...EN_CARD_FILE, ...EN_SET_BANK_APP, ...EN_SET_SECURITY, ...EN_SET_CONNECTIONS, ...EN_SET_MEMBERS, ...EN_SET_IMPORT, ...EN_SET_ACCOUNTS, ...EN_SET_FACTOR, ...EN_SET_SPLIT, ...EN_SET_BANK_KEY, ...EN_SET_LOANS, ...EN_SET_RA_MODEL, ...EN_SET_RECONCILE, ...EN_SET_SYNC, ...EN_SET_TRIAL, ...EN_SET_ASK, ...EN_SET_REMOTE, ...EN_SET_RFORM, ...EN_SET_GUIDE, ...EN_SET_RSTATUS, ...EN_SET_RTOKEN, ...EN_SET_USE_TS, ...EN_SET_ACUSE, ...EN_SET_NOTICES, ...EN_SET_IFORM, ...EN_SET_STATUS, ...EN_SET_OPS, ...EN_SET_ASH, ...EN_SET_BANKS, ...EN_SET_BAPP, ...EN_SET_BRT, ...EN_SET_CV, ...EN_SET_DPAGE, ...EN_SET_DX, ...EN_SET_FR, ...EN_SET_MT, ...EN_SET_REC, ...EN_SET_RR, ...EN_SET_SV, ...EN_SET_TABS, ...EN_SET_RI, ...EN_SET_RV, ...EN_SET_RC, ...EN_BANK_FILE });
