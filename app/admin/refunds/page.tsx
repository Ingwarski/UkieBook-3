import type { Metadata } from "next";

import { ManagerShell } from "../../../components/moderation";
import { RefundQueueScreen } from "../../../components/refunds";
import { requireProtectedPath } from "../../../modules/identity/server/guard";
import { identityRuntime } from "../../../modules/identity/server/runtime";
import { loadRefundQueue } from "../../../modules/library/server";

export const metadata: Metadata = { title: "Повернення" };
export const dynamic = "force-dynamic";

interface RefundsPageProps {
  readonly searchParams: Promise<{ readonly result?: string | string[] }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RefundsPage({ searchParams }: RefundsPageProps) {
  const [context, query] = await Promise.all([requireProtectedPath("/admin/refunds"), searchParams]);
  const items = await loadRefundQueue(identityRuntime().database);
  return (
    <ManagerShell currentSection="refunds" csrfToken={context!.csrfToken}>
      <RefundQueueScreen csrfToken={context!.csrfToken} items={items} result={first(query.result)} />
    </ManagerShell>
  );
}
