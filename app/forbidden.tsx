import Link from "next/link";

import { IdentityShell } from "../components/identity";

export default function Forbidden() {
  return (
    <IdentityShell
      description="Ваш обліковий запис не має доступу до цього розділу."
      headingId="access-forbidden-title"
      title="Доступ заборонено"
    >
      <Link href="/">Повернутися до книгарні</Link>
    </IdentityShell>
  );
}
