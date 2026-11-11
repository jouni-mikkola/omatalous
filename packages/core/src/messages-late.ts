/**
 * The Finnish tables a page needs and the sign-in does not. They are apart from messages.ts so that the browser fetches
 * them beside the sign-in answer and the first screen paints without them (apps/web/src/language.ts); the server and
 * the tests import this file for its side effect, which installs the tables.
 * Decision: the household reaches the sign-in sooner, and no page reads a text before its table is there.
 */
import { FI_ALERTS } from "./messages-alerts.ts";
import { FI_CALC } from "./messages-calc.ts";
import { FI_FORECAST } from "./messages-forecast.ts";
import { FI_PRICES } from "./messages-prices.ts";
import { FI_OPTIMISE } from "./messages-optimise.ts";
import { FI_OPTIMISE_A } from "./messages-optimise-a.ts";
import { FI_OPTIMISE_B } from "./messages-optimise-b.ts";
import { FI_INCOME } from "./messages-income.ts";
import { FI_INSIGHTS } from "./messages-insights.ts";
import { FI_SHEETS } from "./messages-sheets.ts";
import { FI_OFFSITE } from "./messages-offsite.ts";
import { FI_BILLS } from "./messages-bills.ts";
import { FI_BANK_FILE } from "./messages-bank-file.ts";
import { FI_CARD_FILE } from "./messages-card-file.ts";
import { FI_OVERVIEW } from "./messages-overview.ts";
import { FI_REPORTS_1 } from "./messages-reports-1.ts";
import { FI_REPORTS_2 } from "./messages-reports-2.ts";
import { FI_REPORTS_3 } from "./messages-reports-3.ts";
import { FI_REPORTS_4 } from "./messages-reports-4.ts";
import { FI_REPORTS_5 } from "./messages-reports-5.ts";
import { FI_SET_BANK_APP } from "./messages-set-bank-app.ts";
import { FI_SET_SECURITY } from "./messages-set-security.ts";
import { FI_SET_CONNECTIONS } from "./messages-set-connections.ts";
import { FI_SET_MEMBERS } from "./messages-set-members.ts";
import { FI_SET_IMPORT } from "./messages-set-import.ts";
import { FI_SET_ACCOUNTS } from "./messages-set-accounts.ts";
import { FI_SET_FACTOR } from "./messages-set-factor.ts";
import { FI_SET_SPLIT } from "./messages-set-split.ts";
import { FI_SET_BANK_KEY } from "./messages-set-bank-key.ts";
import { FI_SET_LOANS } from "./messages-set-loans.ts";
import { FI_SET_WIZARD } from "./messages-set-wizard.ts";
import { FI_SET_RA_MODEL } from "./messages-set-ra-model.ts";
import { FI_SET_RECONCILE } from "./messages-set-reconcile.ts";
import { FI_SET_SYNC } from "./messages-set-sync.ts";
import { FI_SET_TRIAL } from "./messages-set-trial.ts";
import { FI_SET_ASK } from "./messages-set-ask.ts";
import { FI_SET_REMOTE } from "./messages-set-remote.ts";
import { FI_SET_RFORM } from "./messages-set-rform.ts";
import { FI_SET_GUIDE } from "./messages-set-guide.ts";
import { FI_SET_RSTATUS } from "./messages-set-rstatus.ts";
import { FI_SET_RTOKEN } from "./messages-set-rtoken.ts";
import { FI_SET_USE_TS } from "./messages-set-use-ts.ts";
import { FI_SET_ACUSE } from "./messages-set-acuse.ts";
import { FI_SET_NOTICES } from "./messages-set-notices.ts";
import { FI_SET_IFORM } from "./messages-set-iform.ts";
import { FI_SET_STATUS } from "./messages-set-status.ts";
import { FI_SET_OPS } from "./messages-set-ops.ts";
import { FI_SET_ASH } from "./messages-set-ash.ts";
import { FI_SET_BANKS } from "./messages-set-banks.ts";
import { FI_SET_BAPP } from "./messages-set-bapp.ts";
import { FI_SET_BRT } from "./messages-set-brt.ts";
import { FI_SET_CV } from "./messages-set-cv.ts";
import { FI_SET_DPAGE } from "./messages-set-dpage.ts";
import { FI_SET_DX } from "./messages-set-dx.ts";
import { FI_SET_FR } from "./messages-set-fr.ts";
import { FI_SET_MT } from "./messages-set-mt.ts";
import { FI_SET_REC } from "./messages-set-rec.ts";
import { FI_SET_RR } from "./messages-set-rr.ts";
import { FI_SET_SV } from "./messages-set-sv.ts";
import { FI_SET_TABS } from "./messages-set-tabs.ts";
import { FI_SET_RI } from "./messages-set-ri.ts";
import { FI_SET_RV } from "./messages-set-rv.ts";
import { FI_SET_RC } from "./messages-set-rc.ts";
import { FI_TABLES } from "./messages-tables.ts";
import { FI_TRANSACTIONS } from "./messages-transactions.ts";
import { installLate } from "./messages.ts";

export const FI_LATE = { ...FI_OVERVIEW, ...FI_BILLS, ...FI_TRANSACTIONS, ...FI_TABLES, ...FI_OFFSITE, ...FI_FORECAST, ...FI_SHEETS, ...FI_REPORTS_1, ...FI_REPORTS_2, ...FI_REPORTS_3, ...FI_REPORTS_4, ...FI_REPORTS_5, ...FI_CALC, ...FI_INSIGHTS, ...FI_ALERTS, ...FI_OPTIMISE, ...FI_OPTIMISE_A, ...FI_OPTIMISE_B, ...FI_INCOME, ...FI_PRICES, ...FI_CARD_FILE, ...FI_SET_BANK_APP, ...FI_SET_SECURITY, ...FI_SET_CONNECTIONS, ...FI_SET_MEMBERS, ...FI_SET_IMPORT, ...FI_SET_ACCOUNTS, ...FI_SET_FACTOR, ...FI_SET_SPLIT, ...FI_SET_BANK_KEY, ...FI_SET_LOANS, ...FI_SET_WIZARD, ...FI_SET_RA_MODEL, ...FI_SET_RECONCILE, ...FI_SET_SYNC, ...FI_SET_TRIAL, ...FI_SET_ASK, ...FI_SET_REMOTE, ...FI_SET_RFORM, ...FI_SET_GUIDE, ...FI_SET_RSTATUS, ...FI_SET_RTOKEN, ...FI_SET_USE_TS, ...FI_SET_ACUSE, ...FI_SET_NOTICES, ...FI_SET_IFORM, ...FI_SET_STATUS, ...FI_SET_OPS, ...FI_SET_ASH, ...FI_SET_BANKS, ...FI_SET_BAPP, ...FI_SET_BRT, ...FI_SET_CV, ...FI_SET_DPAGE, ...FI_SET_DX, ...FI_SET_FR, ...FI_SET_MT, ...FI_SET_REC, ...FI_SET_RR, ...FI_SET_SV, ...FI_SET_TABS, ...FI_SET_RI, ...FI_SET_RV, ...FI_SET_RC, ...FI_BANK_FILE } as const;

installLate(FI_LATE);
