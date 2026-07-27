import "server-only";

import type { ServerEnvironment } from "../../platform/environment/server";
import {
  UnavailableEmailAdapter,
  type TransactionalEmailAdapter,
} from "../adapter";
import { FileCapturedEmailAdapter } from "./file-capture-adapter";

export interface NotificationRuntime {
  readonly adapter: TransactionalEmailAdapter;
  readonly from: string;
}

export function notificationRuntime(
  environment: ServerEnvironment,
): NotificationRuntime {
  const captureRoot =
    environment.UNIT05_EMAIL_CAPTURE_ROOT ?? environment.EMAIL_CAPTURE_ROOT;
  return {
    adapter:
      environment.APP_ENV === "test" && captureRoot
        ? new FileCapturedEmailAdapter(captureRoot)
        : new UnavailableEmailAdapter(),
    from: environment.EMAIL_FROM,
  };
}
