import styles from "./aurora.module.css";

export type AuroraStatusTone = "success" | "warning" | "error" | "info";

export interface AuroraStatusBadgeProps {
  label: string;
  tone: AuroraStatusTone;
}

const toneClass: Record<AuroraStatusTone, string> = {
  success: styles.success,
  warning: styles.warning,
  error: styles.errorStatus,
  info: styles.info,
};

export function AuroraStatusBadge({ label, tone }: AuroraStatusBadgeProps) {
  return (
    <span className={[styles.status, toneClass[tone]].join(" ")}>
      <span aria-hidden="true" className={styles.statusDot} />
      {label}
    </span>
  );
}
