"use client";

import { CloudArrowUp, FileText, ImageSquare, LinkSimple } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type DragEvent } from "react";

import styles from "./publishing.module.css";

type UploadKind = "cover" | "illustration" | "manuscript";

interface UploadDropzoneProps {
  readonly accept: string;
  readonly anchorLabel?: string;
  readonly apiUrl: string;
  readonly csrfToken: string;
  readonly description: string;
  readonly kind: UploadKind;
  readonly label: string;
  readonly nextHref?: string;
}

function icon(kind: UploadKind) {
  if (kind === "cover") return <ImageSquare aria-hidden="true" size={34} />;
  if (kind === "illustration") return <ImageSquare aria-hidden="true" size={34} />;
  return <FileText aria-hidden="true" size={34} />;
}

export function UploadDropzone({
  accept,
  anchorLabel,
  apiUrl,
  csrfToken,
  description,
  kind,
  label,
  nextHref,
}: UploadDropzoneProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reportUploadError = (message: string) => {
    setProgress(null);
    setError(message);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const upload = (file: File) => {
    setError(null);
    setSuccess(null);
    setProgress(0);
    const request = new XMLHttpRequest();
    request.open("POST", apiUrl);
    request.responseType = "json";
    request.setRequestHeader("x-csrf-token", csrfToken);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("error", () => {
      reportUploadError("Мережевий збій. Чернетку збережено — спробуйте ще раз.");
    });
    request.addEventListener("load", () => {
      setProgress(null);
      if (request.status >= 200 && request.status < 300) {
        setSuccess(`${file.name} завантажено.`);
        if (nextHref) router.push(nextHref);
        else router.refresh();
        return;
      }
      const response = request.response as { error?: { message?: string } } | null;
      reportUploadError(response?.error?.message ?? "Не вдалося завантажити файл. Спробуйте ще раз.");
    });
    const form = new FormData();
    form.set("file", file);
    if (anchorLabel) form.set("anchorLabel", anchorLabel);
    request.send(form);
  };

  const dropped = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files.item(0);
    if (file) upload(file);
  };

  return (
    <div className={styles.uploadStack}>
      <div
        className={[styles.dropzone, dragging ? styles.dropzoneActive : ""].filter(Boolean).join(" ")}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropped}
      >
        <div>
          {icon(kind)}
          <strong>{label}</strong>
          <span className={styles.fieldHelp} id={descriptionId}>{description}</span>
          <input
            accept={accept}
            aria-describedby={[descriptionId, error ? errorId : undefined].filter(Boolean).join(" ")}
            aria-invalid={error ? true : undefined}
            disabled={progress !== null}
            id={id}
            onChange={(event) => {
              const file = event.currentTarget.files?.item(0);
              if (file) upload(file);
            }}
            ref={inputRef}
            type="file"
          />
          <label className={styles.uploadButton} htmlFor={id}>
            <CloudArrowUp aria-hidden="true" size={19} /> Обрати файл
          </label>
        </div>
      </div>
      {progress !== null ? (
        <div aria-live="polite">
          <progress aria-label="Прогрес завантаження" className={styles.uploadProgress} max={100} value={progress} />
          <span className={styles.fieldHelp}> Завантаження: {progress}%</span>
        </div>
      ) : null}
      {success ? <div className={styles.inlineSuccess} role="status">{success}</div> : null}
      {error ? <div className={styles.inlineError} id={errorId} role="alert">{error} <button className={styles.textLink} onClick={() => inputRef.current?.click()} type="button">Повторити</button></div> : null}
    </div>
  );
}

interface GoogleDocsImporterProps {
  readonly apiUrl: string;
  readonly csrfToken: string;
  readonly nextHref: string;
}

export function GoogleDocsImporter({ apiUrl, csrfToken, nextHref }: GoogleDocsImporterProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [documentUrl, setDocumentUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={styles.googleDocsForm}
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          const response = await fetch(apiUrl, {
            body: JSON.stringify({ documentUrl }),
            headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
            method: "POST",
          });
          const body = (await response.json()) as { error?: { message?: string } };
          if (!response.ok) throw new Error(body.error?.message ?? "Не вдалося імпортувати документ.");
          router.push(nextHref);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Не вдалося імпортувати документ.");
          requestAnimationFrame(() => inputRef.current?.focus());
        } finally {
          setPending(false);
        }
      }}
    >
      <div className={styles.field}>
        <label htmlFor={id}>Посилання Google Docs</label>
        <input
          aria-describedby={[descriptionId, error ? errorId : undefined].filter(Boolean).join(" ")}
          aria-invalid={error ? true : undefined}
          id={id}
          onChange={(event) => setDocumentUrl(event.currentTarget.value)}
          placeholder="https://docs.google.com/document/d/…"
          ref={inputRef}
          required
          type="url"
          value={documentUrl}
        />
        <span className={styles.fieldHelp} id={descriptionId}>Імпорт використовує окремий доступ до документа й не зберігає токени вашого входу.</span>
      </div>
      <button className={styles.secondaryLink} disabled={pending} type="submit">
        <LinkSimple aria-hidden="true" size={18} /> {pending ? "Імпортуємо…" : "Імпортувати з Google Docs"}
      </button>
      {error ? <div className={styles.inlineError} id={errorId} role="alert">{error}</div> : null}
    </form>
  );
}
