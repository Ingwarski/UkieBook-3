import type { InputHTMLAttributes } from "react";

import styles from "./aurora.module.css";

export interface AuroraFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "aria-describedby" | "id"> {
  description?: string;
  error?: string;
  id: string;
  label: string;
}

export function AuroraField({
  className,
  description,
  error,
  id,
  label,
  required,
  ...props
}: AuroraFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className={styles.required}>
              {" "}*
            </span>
            <span className={styles.visuallyHidden}> (обов’язкове поле)</span>
          </>
        ) : null}
      </label>
      <input
        {...props}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error) || undefined}
        className={[styles.input, className].filter(Boolean).join(" ")}
        id={id}
        required={required}
      />
      {description ? (
        <p className={styles.description} id={descriptionId}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
