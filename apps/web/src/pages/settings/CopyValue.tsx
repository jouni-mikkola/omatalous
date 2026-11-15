import { type KeyboardEvent, useState } from "react";
import { copyText } from "../../clipboard.ts";
import { Button } from "../../components/ui/Button.tsx";
import { t } from "../../text.ts";
/** Copies `text` and says so for two seconds. */
function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return { copied, copy };
}

/** The keys of a value that copies: a tab stop that Enter and Space press like a click. */
function pressable(copy: () => void, title: string) {
  return {
    role: "button",
    tabIndex: 0,
    title,
    onClick: copy,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        copy();
      }
    },
  } as const;
}

/** A value to paste into Enable Banking, with a button that copies it. When copying fails the text stays selectable. */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy(value);
  return (
    <>
      <code className="copyable" {...pressable(copy, t("set.cv.copy"))}>
        {value}
      </code>{" "}
      <Button aria-label={`${copied ? t("set.cv.copied") : t("set.cv.copy")} ${label}`} onClick={copy}>
        {copied ? t("set.cv.copied") : t("set.cv.copy")}
      </Button>
    </>
  );
}

/** A value of a list that one "Kopioi kaikki" button copies; a click on the value copies it alone, and the text stays selectable. */
export function Copyable({ value }: { value: string }) {
  const { copied, copy } = useCopy(value);
  return (
    <code className="copyable" {...pressable(copy, copied ? t("set.cv.copied") : t("set.cv.copy"))}>
      {value}
    </code>
  );
}

/** The one button of a list of values: copies one "label: value" line each. */
export function CopyAll({ fields }: { fields: { label: string; value: string }[] }) {
  const { copied, copy } = useCopy(fields.map((f) => `${f.label}: ${f.value}`).join("\n"));
  return (
    <Button onClick={copy}>
      {copied ? t("set.cv.copied") : t("set.cv.copy_all")}
    </Button>
  );
}
