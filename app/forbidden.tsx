import { IdentityShell } from "../components/identity";

export default function Forbidden() {
  return (
    <IdentityShell
      description="Ваш обліковий запис не має доступу до цього розділу."
      headingId="access-forbidden-title"
      title="Доступ заборонено"
    >
      <a href="/">Повернутися до книгарні</a>
    </IdentityShell>
  );
}
