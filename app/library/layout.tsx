import type { ReactNode } from "react";

import { requireProtectedPath } from "../../modules/identity/server/guard";

export default async function LibraryLayout({ children }: { children: ReactNode }) {
  await requireProtectedPath("/library");
  return children;
}
