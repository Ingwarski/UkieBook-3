"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";

import { AuroraButton, type AuroraButtonVariant } from "../aurora";

const subscribeToHydration = () => () => undefined;

interface ModerationSubmitButtonProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly pendingLabel?: string;
  readonly variant?: AuroraButtonVariant;
}

export function ModerationSubmitButton({
  children,
  className,
  disabled = false,
  pendingLabel = "Зберігаємо…",
  variant = "primary",
}: ModerationSubmitButtonProps) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const { pending } = useFormStatus();

  return (
    <AuroraButton
      busy={pending}
      className={className}
      disabled={disabled || !hydrated}
      type="submit"
      variant={variant}
    >
      {pending ? pendingLabel : children}
    </AuroraButton>
  );
}
