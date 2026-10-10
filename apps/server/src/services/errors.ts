/** An error whose message is safe and useful to show to the user (HTTP 400). */
export class UserError extends Error {}

/** A refusal with its own status (403 wrong password, 409 something else is running); the message is safe to show. */
export class HttpUserError extends UserError {
  constructor(
    message: string,
    readonly status: 403 | 409 | 503,
  ) {
    super(message);
  }
}

/** Too many attempts: HTTP 429 with Retry-After (seconds). */
export class TooManyAttempts extends UserError {
  constructor(
    message: string,
    readonly retryAfter: number,
  ) {
    super(message);
  }
}

export const tooManyMessage = (waitSeconds: number) => `Liian monta yritystä. Yritä uudelleen ${Math.max(1, Math.ceil(waitSeconds / 60))} min päästä.`;
