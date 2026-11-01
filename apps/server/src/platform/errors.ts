import { refusalIn } from "./refusals-en.ts";
import { DEFAULT_LANGUAGE, type Language, type MessageCode, message, messageFromWire, messageIn } from "@banking/core";

/** The code of a catalogue message and its parameters, sent beside the sentence (core messages.ts). */
type MessageInfo = { code: MessageCode; params?: Record<string, string | number> };

/**
 * The body of an error answer: the sentence stays in `error` for older clients, and a coded message adds
 * `messageCode` and `params` for the browser to format. Only catalogue words and the values given here reach it.
 */
export function errorBody(text: string, info?: MessageInfo): { error: string; messageCode?: MessageCode; params?: Record<string, string | number> } {
  return info ? { error: text, messageCode: info.code, ...(info.params ? { params: info.params } : {}) } : { error: text };
}

type Rest<C extends MessageCode> = Parameters<typeof message<C>> extends [unknown, ...infer P] ? P : never;
const infoOf = (code: MessageCode, params: unknown[]): MessageInfo => ({ code, ...(params[0] ? { params: params[0] as Record<string, string | number> } : {}) });

/** The body for a catalogue code. */
export const coded = <C extends MessageCode>(code: C, ...params: Rest<C>) => errorBody(message(code, ...(params as never)), infoOf(code, params));

/** The language of the member a request is made for; Finnish before anyone is signed in. */
export const languageOf = (c: { get(key: "user"): { language: Language } | undefined }): Language => c.get("user")?.language ?? DEFAULT_LANGUAGE;

/** The body for a catalogue code, its sentence in the language of the member the request is made for. */
export const codedFor = <C extends MessageCode>(c: Parameters<typeof languageOf>[0], code: C, ...params: Rest<C>) =>
  errorBody(messageIn(languageOf(c), code, ...(params as never)), infoOf(code, params));

/**
 * The sentence of a refusal in the reader's language: from the catalogue when the refusal has a code, else the text it
 * was thrown with (not yet in the catalogue: `refusals-en.ts` knows its English). The browser formats the code itself; this is for older clients.
 */
export function sentenceFor(err: UserError, lang: Language): string {
  return (err.info && messageFromWire(err.info.code, err.info.params, lang)) || refusalIn(err.message, lang);
}

/** An error whose message is safe and useful to show to the user (HTTP 400). */
export class UserError extends Error {
  constructor(
    text: string,
    readonly info?: MessageInfo,
  ) {
    super(text);
  }

  /** A refusal from the catalogue: the sentence is made from the code, and the code goes to the browser. */
  static of<C extends MessageCode>(code: C, ...params: Rest<C>): UserError {
    return new UserError(message(code, ...(params as never)), infoOf(code, params));
  }
}

/**
 * The row a request names does not exist for this user (HTTP 404). Another member's row looks the same as a missing
 * one. Not a UserError, so code that catches a refusal does not catch it.
 */
export class NotFound extends Error {}

/** A refusal with its own status (403 wrong password, 409 something else is running); the message is safe to show. */
export class HttpUserError extends UserError {
  constructor(
    message: string,
    readonly status: 403 | 409 | 503,
    info?: MessageInfo,
  ) {
    super(message, info);
  }
}

/**
 * A service outside the app (a bank API) failed: HTTP 502. `message` is for the log and may name the upstream's
 * status and path; `userMessage` is what the browser is told and never holds the upstream's own text.
 */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
  }
}

/** Too many attempts: HTTP 429 with Retry-After (seconds). */
export class TooManyAttempts extends UserError {
  constructor(
    message: string,
    readonly retryAfter: number,
    info?: MessageInfo,
  ) {
    super(message, info);
  }
}

const minutes = (waitSeconds: number) => Math.max(1, Math.ceil(waitSeconds / 60));
/** The 429 of a limiter that says how long to wait. */
export const tooMany = (waitSeconds: number) =>
  new TooManyAttempts(message("auth.too_many", { minutes: minutes(waitSeconds) }), waitSeconds, { code: "auth.too_many", params: { minutes: minutes(waitSeconds) } });
/** The 429 of the password gate when every hash slot is taken. */
export const hashBusy = () => new TooManyAttempts(message("auth.busy"), 2, { code: "auth.busy" });
/** The body of that answer, for a route that answers it itself. */
export const tooManyBody = (waitSeconds: number) => coded("auth.too_many", { minutes: minutes(waitSeconds) });
