import { useState } from "react";
import { copyText } from "../../clipboard.ts";

/** A value to paste into Enable Banking, with a button that copies it. When copying fails the text stays selectable. */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <>
      <code className="copyable" onClick={copy} title="Kopioi">
        {value}
      </code>{" "}
      <button className="btn btn-small" type="button" aria-label={`${copied ? "Kopioitu" : "Kopioi"} ${label}`} onClick={copy}>
        {copied ? "Kopioitu" : "Kopioi"}
      </button>
    </>
  );
}
