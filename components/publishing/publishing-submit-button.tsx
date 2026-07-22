"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";

import { AuroraButton, type AuroraButtonVariant } from "../aurora";

const subscribeToHydration = () => () => undefined;

interface PublishingSubmitButtonProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly variant?: AuroraButtonVariant;
}

export function PublishingSubmitButton({
  children,
  className,
  disabled = false,
  variant = "primary",
}: PublishingSubmitButtonProps) {
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const { pending } = useFormStatus();

  return (
    <AuroraButton
      busy={pending}
      className={className}
      disabled={disabled || !hydrated}
      type="submit"
      variant={variant}
    >
      {children}
    </AuroraButton>
  );
}
