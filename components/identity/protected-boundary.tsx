import { IdentityShell } from "./identity-shell";

export interface ProtectedBoundaryProps {
  csrfToken: string;
  description: string;
  title: string;
}

export function ProtectedBoundary({
  csrfToken,
  description,
  title,
}: ProtectedBoundaryProps) {
  return (
    <IdentityShell
      description={description}
      headingId="protected-boundary-title"
      title={title}
    >
      <form action="/api/auth/logout" method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <button type="submit">Вийти</button>
      </form>
    </IdentityShell>
  );
}
