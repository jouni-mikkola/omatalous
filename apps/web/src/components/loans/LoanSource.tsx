import { type LoanDraft, parseLoanText } from "@banking/core";
import { type ChangeEvent, type ClipboardEvent, type DragEvent, useEffect, useId, useRef, useState } from "react";
import { t } from "../../text.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { isPdf, isText, whatWasPasted } from "./paste.ts";
import { ReadAborted, ReadError, readPdf } from "./read-source.ts";

/** More text than this is no loan's: a bank's whole export, say. */
const MAX_TEXT = 200_000;
/** A statement is some hundred kilobytes; a file this large is not one. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * The input box of a new loan: text pasted or typed, or a PDF dropped, pasted or chosen. Both are read in this browser
 * and nothing is sent anywhere. `onDrafts` gets what the text holds, one draft per loan, and the household checks it
 * in the form; a text that holds no loan figure is told here.
 */
export function LoanSource({ today, onDrafts }: { today: string; onDrafts: (drafts: LoanDraft[]) => void }) {
  const uid = useId();
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = useRef<AbortController | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  // a read that is still going when the form closes is ended with it
  useEffect(() => () => run.current?.abort(), []);

  const finish = (read: string) => {
    if (read.length > MAX_TEXT) return setProblem(t("set.ln.the_file_is_too_large"));
    const drafts = parseLoanText(read, { asOf: today });
    if (drafts.length === 0) return setProblem(t("set.ln.no_loan_details_were_found"));
    onDrafts(drafts);
  };

  const readFile = async (file: File) => {
    run.current?.abort();
    const mine = new AbortController();
    run.current = mine;
    setProblem(null);
    setReading(false);
    if (file.size > MAX_FILE_BYTES) return setProblem(t("set.ln.the_file_is_too_large"));
    if (isText(file)) {
      try {
        const read = await file.text();
        if (mine.signal.aborted) return;
        setText(read);
        finish(read);
      } catch {
        setProblem(t("set.ln.the_file_could_not_be"));
      }
      return;
    }
    if (!isPdf(file)) return setProblem(t("set.ln.the_file_is_not_a_pdf"));
    setReading(true);
    try {
      const read = await readPdf(await file.arrayBuffer(), mine.signal);
      if (read.trim() === "") setProblem(t("set.ln.the_pdf_has_only_an"));
      else finish(read);
    } catch (err) {
      if (err instanceof ReadAborted) return;
      setProblem(err instanceof ReadError ? err.message : t("set.ln.the_file_could_not_be"));
    } finally {
      if (run.current === mine) {
        run.current = null;
        setReading(false);
      }
    }
  };

  const take = (files: readonly File[], plain: string, event: { preventDefault: () => void }) => {
    const got = whatWasPasted(files, plain);
    if (!got && files.length === 0) return;
    event.preventDefault();
    if (!got) return void readFile(files[0]!);
    if ("file" in got) return void readFile(got.file);
    setText(got.text);
    finish(got.text);
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = [...e.clipboardData.files];
    // a paste into text the household typed is theirs to edit: it is read with Lue tiedot
    if (files.length === 0 && text.trim() !== "") return;
    take(files, e.clipboardData.getData("text/plain"), e);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setOver(false);
    take([...e.dataTransfer.files], e.dataTransfer.getData("text/plain"), e);
  };
  const onChoose = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void readFile(file);
  };

  return (
    <div
      className={`loan-box${over ? " over" : ""}`}
      onPaste={onPaste}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <label className="field-label" htmlFor={`${uid}-text`}>
        {t("set.ln.box_label")}
      </label>
      <textarea id={`${uid}-text`} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="form-row">
        <Button onClick={() => finish(text)} disabled={text.trim() === "" || reading}>
          {t("set.ln.read_the_loan_details")}
        </Button>
        <Button onClick={() => picker.current?.click()}>{t("set.ln.choose_a_pdf")}</Button>
        <input ref={picker} type="file" accept=".pdf,application/pdf,.txt,text/plain" tabIndex={-1} aria-label={t("set.ln.choose_a_pdf")} onChange={onChoose} />
      </div>
      {reading && (
        <div className="loan-readline" role="status">
          <span>{t("set.ln.reading_the_pdf")}</span>
          <Button variant="link" onClick={() => run.current?.abort()}>
            {t("set.ln.stop")}
          </Button>
        </div>
      )}
      {problem && <Notice tone="error">{problem}</Notice>}
    </div>
  );
}
