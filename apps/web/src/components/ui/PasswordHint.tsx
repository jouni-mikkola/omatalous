/** What the password typed so far is worth, while it is typed: the reason when it is refused, else its strength. The server checks the same rule (core `checkPassword`). */
import { checkPassword, passwordLevelText } from "@banking/core";
import { language } from "../../format.ts";

export function PasswordHint({ password }: { password: string }) {
  if (!password) return <p className="password-hint" aria-live="polite" />;
  const { problem, level } = checkPassword(password, language());
  return (
    <p className={`password-hint level-${level}`} aria-live="polite">
      <span className="password-meter" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= level ? "on" : undefined} />
        ))}
      </span>
      {problem ?? passwordLevelText(level as 1 | 2 | 3 | 4, language())}
    </p>
  );
}
