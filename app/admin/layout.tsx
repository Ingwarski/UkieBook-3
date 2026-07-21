import type { ReactNode } from "react";

import { requireProtectedPath } from "../../modules/identity/server/guard";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireProtectedPath("/admin");
  return children;
}
