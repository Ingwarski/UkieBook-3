import type { Metadata } from "next";

import {
  ManagerShell,
  ModerationQueueScreen,
} from "../../../components/moderation";
import { requireProtectedPath } from "../../../modules/identity/server/guard";
import { identityRuntime } from "../../../modules/identity/server/runtime";
import {
  MODERATION_SUBJECT_TYPES,
  type ModerationSubjectType,
} from "../../../modules/moderation/types";
import { loadManagerModerationQueue } from "../../../modules/moderation/server/service";
import { publishingPrivateObjectStorage } from "../../../modules/publishing/storage/runtime";

export const metadata: Metadata = { title: "Ручна перевірка" };
export const dynamic = "force-dynamic";

interface ModerationPageProps {
  readonly searchParams: Promise<{
    readonly case?: string | string[];
    readonly decision?: string | string[];
    readonly error?: string | string[];
    readonly result?: string | string[];
    readonly type?: string | string[];
  }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function selectedType(value: string | undefined): ModerationSubjectType | "all" {
  if (value && (MODERATION_SUBJECT_TYPES as readonly string[]).includes(value)) {
    return value as ModerationSubjectType;
  }
  return "all";
}

function selectedCaseId(value: string | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  )
    ? value
    : null;
}

export default async function ModerationPage({ searchParams }: ModerationPageProps) {
  const context = await requireProtectedPath("/admin/moderation");
  const runtime = identityRuntime();
  const query = await searchParams;
  const requestedCaseId = selectedCaseId(first(query.case));
  const queue = await loadManagerModerationQueue(
    runtime.database,
    publishingPrivateObjectStorage(),
    {
      selectedCaseId: requestedCaseId,
      subjectType: selectedType(first(query.type)),
    },
  );
  return (
    <ManagerShell csrfToken={context!.csrfToken}>
      <ModerationQueueScreen
        csrfToken={context!.csrfToken}
        decision={first(query.decision)}
        detailOpen={requestedCaseId !== null}
        error={first(query.error)}
        queue={queue}
        result={first(query.result)}
      />
    </ManagerShell>
  );
}
