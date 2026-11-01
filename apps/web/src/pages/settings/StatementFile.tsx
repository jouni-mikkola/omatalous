/** Asetukset > Pankit ja tilit: one place to read a statement from a file, whatever it is: a bank's CSV export, a camt.053 statement or a card statement. The file is read in this browser; only its rows are sent. */
// Decision: a household whose bank gives rows only as a file picks the file once and is not asked what kind it is (ADR 0025)
import { readCardFile } from "@banking/core";
import { type ChangeEvent, useRef, useState } from "react";
import { isPdf } from "../../components/loans/paste.ts";
import { readPdf } from "../../components/loans/read-source.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import type { Meta } from "../../types.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { t } from "../../text.ts";
import { BankRows } from "./BankFile.tsx";
import { CardRows } from "./CardFile.tsx";

/** A statement is a few kilobytes of text, a PDF of it a few hundred. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** A text file in the encoding a Finnish bank may give it: UTF-8, else Windows-1252. */
function decode(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** XML is a bank's camt.053; a layout of a card statement is a card's; any other table is a bank's CSV. */
function kindOf(text: string): "card" | "bank" {
  if (/^\uFEFF?\s*</.test(text)) return "bank";
  const card = readCardFile(text);
  return card.ok || card.error !== "unknown_layout" ? "card" : "bank";
}

export function StatementFile({ meta, onChange }: { meta: Meta; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<"big" | "pdf" | null>(null);
  const [picked, setPicked] = useState<{ n: number; kind: "card" | "bank"; text: string } | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPicked(null);
    setProblem(null);
    if (file.size > MAX_FILE_BYTES) return setProblem("big");
    setReading(true);
    try {
      const bytes = await file.arrayBuffer();
      let text: string;
      let kind: "card" | "bank";
      try {
        const pdf = isPdf(file);
        text = pdf ? await readPdf(bytes, new AbortController().signal) : decode(bytes);
        kind = pdf ? "card" : kindOf(text);
      } catch {
        return setProblem("pdf");
      }
      setPicked((p) => ({ n: (p?.n ?? 0) + 1, kind, text }));
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="card" id={SETTINGS_ANCHOR.statement}>
      <div className="card-head">
        <div>
          <h2>{t("card_file.title")}</h2>
          <div className="card-sub">{t("card_file.sub")}</div>
        </div>
      </div>
      <div className="stack">
        <input ref={input} type="file" accept=".csv,.tsv,.txt,.xml,.pdf,text/*,application/xml,application/pdf" onChange={pick} hidden data-kind="statement-file" />
        <div className="form-row">
          <Button onClick={() => input.current?.click()} busy={reading}>
            {reading ? t("card_file.reading") : t("card_file.pick")}
          </Button>
          <span className="field-help">{t("card_file.formats")}</span>
        </div>
        {problem && <Notice tone="warning">{problem === "big" ? t("card_file.err_big") : t("card_file.err_pdf")}</Notice>}
        {picked?.kind === "card" && <CardRows key={picked.n} text={picked.text} meta={meta} onChange={onChange} />}
        {picked?.kind === "bank" && <BankRows key={picked.n} text={picked.text} meta={meta} onChange={onChange} />}
      </div>
    </div>
  );
}
