import { parseLoanText } from "@banking/core";
import { type ClipboardEvent, type DragEvent, useEffect, useId, useRef, useState } from "react";
import { loanCalls } from "../../api.ts";
import { emptyForm, formOfDraft, type LoanForm } from "../../components/loans/form.ts";
import { LoanEditor } from "../../components/loans/LoanEditor.tsx";
import { isPdf, isText, whatWasPasted } from "../../components/loans/paste.ts";
import { type PictureProgress, ReadAborted, ReadError, readPdf, readPicture } from "../../components/loans/read-source.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { t, tn } from "../../text.ts";
/** A pasted page of text is a few thousand characters; more than this is no loan page. */
const MAX_TEXT = 200_000;
/** A screenshot is a few megabytes at most. A larger file is refused before it fills the phone's memory. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

interface Draft {
  key: number;
  title: string;
  form: LoanForm;
  /** Read from what is in the box, or typed in by hand. */
  read: boolean;
}

/** What the status line says while a file is read. The percent is shown beside it and not announced. */
function progressText(progress: PictureProgress | "pdf"): string {
  if (progress === "pdf") return t("set.ln.reading_the_pdf");
  if (progress.step === "load") return t("set.ln.loading_the_image_reader_the");
  // measured on a phone-sized Chromium at a quarter of the CPU: a screenshot of three loans takes about five seconds
  return t("set.ln.reading_the_image");
}

/**
 * Decision: the household gets a loan in with almost no typing. One box takes a picture, a PDF or text of the loan
 * (pasted, dropped, picked or typed). What is read shows as a form per loan, each figure with the line it came from,
 * and nothing is saved before Tallenna. The picture and the text are read in this browser and are sent nowhere.
 */
export function LoanIntake({ today, onSaved }: { today: string; onSaved: (name: string) => void }) {
  const uid = useId();
  const [text, setText] = useState("");
  /** Text read from a picture stays `ocr` while it is in the box: every field of it is to check. */
  const [source, setSource] = useState<"text" | "ocr">("text");
  const [progress, setProgress] = useState<PictureProgress | "pdf" | null>(null);
  /** What the status line says when no file is being read: how many loans were found, or that the read was ended. */
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [over, setOver] = useState(false);
  const nextKey = useRef(1);
  /** A newer file or text makes an older reading stale: its result is dropped. */
  const reading = useRef(0);
  /** Ends the file that is being read: a newer file or text, Keskeytä and leaving the page all call it. */
  const running = useRef<AbortController | null>(null);
  /** The element that gets focus after the next render: the first form after a read, the box after a save. */
  const focusAfter = useRef<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const boxId = `${uid}-text`;
  const headingId = (key: number) => `${uid}-draft-${key}`;

  const draftsNow = useRef(drafts);
  draftsNow.current = drafts;

  useEffect(() => {
    const id = focusAfter.current;
    focusAfter.current = null;
    if (id) document.getElementById(id)?.focus();
  });
  useEffect(() => () => running.current?.abort(), []);

  const stopReading = () => {
    running.current?.abort();
    running.current = null;
  };

  const show = (content: string, from: "text" | "ocr") => {
    setText(content);
    setSource(from);
    const found = parseLoanText(content.slice(0, MAX_TEXT), { asOf: today, source: from });
    const first = nextKey.current;
    setDrafts(found.map((draft, i) => ({ key: nextKey.current++, title: found.length > 1 ? t("set.ln.loan_n", { n: i + 1 }) : t("set.ln.loan_read"), form: formOfDraft(draft, today), read: true })));
    if (found.length > 0) focusAfter.current = headingId(first);
    setNote(found.length > 0 ? tn(found.length, "set.ln.found_one", "set.ln.found_many") : "");
    const advice = from === "ocr" ? t("set.ln.no_loan_details_were_found") : t("set.ln.no_loan_details_were_found_2");
    setProblem(found.length > 0 ? null : advice);
  };

  /** Text the household gave itself: it replaces a file that is still being read. */
  const showText = (content: string, from: "text" | "ocr" = "text") => {
    stopReading();
    reading.current++;
    setProgress(null);
    show(content, from);
  };

  const takeFile = async (file: File) => {
    stopReading();
    const id = ++reading.current;
    const mine = new AbortController();
    running.current = mine;
    setProblem(null);
    setNote("");
    setDrafts([]);
    try {
      if (file.size > MAX_FILE_BYTES) throw new ReadError(t("set.ln.the_file_is_too_large"));
      if (isPdf(file)) {
        setProgress("pdf");
        const content = await readPdf(await file.arrayBuffer(), mine.signal);
        if (id !== reading.current) return;
        if (!/\p{L}/u.test(content)) throw new ReadError(t("set.ln.the_pdf_has_only_an"));
        show(content, "text");
      } else if (file.type.startsWith("image/")) {
        setProgress({ step: "load", share: 0 });
        const content = await readPicture(file, (p) => id === reading.current && setProgress(p), mine.signal);
        if (id === reading.current) show(content, "ocr");
      } else if (isText(file)) {
        const content = await file.text();
        if (id === reading.current) show(content, "text");
      } else throw new ReadError(t("set.ln.the_file_is_not_an"));
    } catch (err) {
      if (id === reading.current && !(err instanceof ReadAborted)) setProblem(err instanceof ReadError ? err.message : t("set.ln.the_file_could_not_be"));
    } finally {
      if (running.current === mine) running.current = null;
      if (id === reading.current) setProgress(null);
    }
  };

  /** Keskeytä: the read ends and the box is ready for another. */
  const cancel = () => {
    stopReading();
    reading.current++;
    setProgress(null);
    setNote(t("set.ln.reading_was_cancelled"));
    focusAfter.current = boxId;
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const pasted = whatWasPasted([...e.clipboardData.files], e.clipboardData.getData("text/plain"));
    if (!pasted) return;
    if ("file" in pasted) {
      e.preventDefault();
      void takeFile(pasted.file);
      return;
    }
    // text pasted into an empty box is the loan: read at once. Pasted into text that is being edited, it is an edit.
    if (text.trim() !== "") return;
    e.preventDefault();
    showText(pasted.text);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) return void takeFile(file);
    const dropped = e.dataTransfer.getData("text/plain");
    if (dropped.trim() !== "") showText(dropped);
  };

  const close = (key: number) => {
    const closed = draftsNow.current.find((d) => d.key === key);
    const rest = draftsNow.current.filter((d) => d.key !== key);
    setDrafts(rest);
    // the form that had focus is gone: the next loan that was read, else the box
    const next = rest.find((d) => d.read);
    focusAfter.current = next ? headingId(next.key) : boxId;
    // the last form of a reading is done: the box is ready for the next loan
    if (closed?.read && !next) {
      setText("");
      setSource("text");
      setNote("");
    }
  };

  const status = progress ? progressText(progress) : note;

  return (
    <div className="section-nested loan-intake">
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
        <label className="field-label" htmlFor={boxId}>
          {t("set.ln.paste_an_image_or_text")}
        </label>
        <textarea
          id={boxId}
          value={text}
          rows={4}
          placeholder={t("set.ln.paste_a_screenshot_or_text")}
          aria-describedby={`${uid}-privacy`}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value === "") setSource("text");
          }}
        />
        <div className="form-row">
          <Button variant="primary" disabled={text.trim() === "" || progress !== null} onClick={() => showText(text, source)}>
            {t("set.ln.read_the_loan_details")}
          </Button>
          <Button onClick={() => picker.current?.click()}>
            {t("set.ln.choose_an_image_or_pdf")}
          </Button>
          <Button variant="link" onClick={() => setDrafts([...drafts, { key: nextKey.current++, title: "Uusi laina", form: emptyForm(today), read: false }])}>
            {t("set.ln.add_by_hand")}
          </Button>
          <input
            ref={picker}
            type="file"
            hidden
            aria-label={t("set.ln.image_or_pdf_of_the")}
            accept="image/*,application/pdf,.pdf,text/plain"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void takeFile(file);
            }}
          />
        </div>
        <p id={`${uid}-privacy`}>
          {t("set.ln.the_image_and_text_are")}
        </p>
      </div>

      {/* mounted all the time, so a screen reader hears what is put into it: the read, then how many loans it found */}
      <div className={`loan-readline${status ? " busy" : ""}`}>
        {progress && <progress value={progress !== "pdf" && progress.step === "read" ? progress.share : undefined} max={1} aria-label={t("set.ln.reading")} />}
        <div className="loan-status" role="status">
          {status}
        </div>
        {progress && progress !== "pdf" && progress.step === "read" && <span aria-hidden="true">{Math.round(progress.share * 100)} %</span>}
        {progress && (
          <Button variant="link" onClick={cancel}>
            {t("set.ln.stop")}
          </Button>
        )}
      </div>
      {problem && (
        <Notice tone="warning" role="alert">
          {problem}
        </Notice>
      )}

      {drafts.map((draft) => (
        <section key={draft.key} className="loan-draft" aria-labelledby={headingId(draft.key)}>
          <h3 id={headingId(draft.key)} tabIndex={-1}>
            {draft.title}
          </h3>
          <LoanEditor
            initial={draft.form}
            today={today}
            cancelLabel={t("set.ln.discard")}
            onSave={async (body) => {
              await loanCalls.add(body);
              close(draft.key);
              onSaved(body.name);
            }}
            onCancel={() => close(draft.key)}
          />
        </section>
      ))}

      <p className="loan-tip">{t("set.ln.a_screenshot_of_the_positive")}</p>
    </div>
  );
}
