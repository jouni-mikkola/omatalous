/**
 * The household's word on where an instalment plan ends (`LoanProposal.plan`): the month of its last payment, or that
 * it does not know. The answer is a mark on the proposal's series key, `question:plan-end:<YYYY-MM>:<key>` or
 * `question:plan-unknown:<key>`, mark `in_use`. The latest answer for a series stands.
 */

/** The marks of `UserInputs`, by shape: this file imports no module that reads the commitments, which read this. */
interface Marked {
  marks: readonly { subject: string; mark: string; markedAt: string }[];
}

const PLAN_QUESTION = "question:plan-";
/** A series key (`seriesId`, ADR 0009) by its shape. */
const SERIES_KEY = /^out:[^:\p{Cc}]{1,28}:[^\p{Cc}]{1,160}$/u;

/** The subject of an answer to the plan question. */
export const planSubject = (endMonth: string | null, key: string): string => (endMonth === null ? `${PLAN_QUESTION}unknown:${key}` : `${PLAN_QUESTION}end:${endMonth}:${key}`);

/** The month (null: not known) and series key a plan subject names, or null for any other subject, a month that is none and a key no series has. */
export function parsePlanSubject(subject: string): { endMonth: string | null; key: string } | null {
  if (!subject.startsWith(PLAN_QUESTION)) return null;
  const [form, ...rest] = subject.slice(PLAN_QUESTION.length).split(":");
  const month = form === "end" ? (rest.shift() ?? "") : null;
  const key = rest.join(":");
  if (!SERIES_KEY.test(key) || (form !== "end" && form !== "unknown")) return null;
  return month === null || /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? { endMonth: month, key } : null;
}

/** The latest answer for each series key. */
export function planAnswers(inputs: Marked): Map<string, string | null> {
  const latest = new Map<string, { endMonth: string | null; at: string }>();
  for (const m of inputs.marks) {
    const a = m.mark === "in_use" ? parsePlanSubject(m.subject) : null;
    if (a && (latest.get(a.key)?.at ?? "") <= m.markedAt) latest.set(a.key, { endMonth: a.endMonth, at: m.markedAt });
  }
  return new Map([...latest].map(([key, a]) => [key, a.endMonth]));
}

/** The marks that end plans: the series of a plan whose answered end month is before the month of `today`, in the form of a cancelled mark's subject (`series:<key>`), which every fixed cost and forecast already leaves out. */
export function endedPlanSubjects(inputs: Marked, today: string): string[] {
  return [...planAnswers(inputs)].flatMap(([key, endMonth]) => (endMonth !== null && endMonth < today.slice(0, 7) ? [`series:${key}`] : []));
}
