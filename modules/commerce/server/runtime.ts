import "server-only";

import { readServerEnvironment } from "../../platform/environment/server";
import type { ServerEnvironment } from "../../platform/environment/server";
import { productionDatabase } from "../../platform/server/database";
import type { SqlDatabase } from "../../platform/sql-port";
import {
  UnavailablePaymentProviderAdapter,
  type PaymentProviderAdapter,
} from "../adapter";
import { MonoPaymentAdapter } from "../mono-adapter";

export interface CommerceRuntimeConfig {
  readonly appOrigin: string;
  readonly reconciliationIntervalMs: number;
  readonly validitySeconds: number;
  readonly webhookMaxBytes: number;
}

export interface CommerceRuntime {
  readonly config: CommerceRuntimeConfig;
  readonly database: SqlDatabase;
  readonly provider: PaymentProviderAdapter;
}

export function commerceConfig(
  environment: ServerEnvironment,
): CommerceRuntimeConfig {
  return {
    appOrigin: new URL(environment.APP_ORIGIN).origin,
    reconciliationIntervalMs: environment.PAYMENT_RECONCILIATION_INTERVAL_MS,
    validitySeconds: environment.PAYMENT_SESSION_VALIDITY_SECONDS,
    webhookMaxBytes: environment.PAYMENT_WEBHOOK_MAX_BYTES,
  };
}

export function commercePaymentProvider(
  environment: ServerEnvironment,
): PaymentProviderAdapter {
  if (!environment.MONO_MERCHANT_TOKEN) {
    return new UnavailablePaymentProviderAdapter();
  }
  return new MonoPaymentAdapter({
    allowInsecureLoopback: environment.APP_ENV === "test",
    apiOrigin: environment.MONO_API_ORIGIN,
    merchantToken: environment.MONO_MERCHANT_TOKEN,
    publicKeyBase64: environment.MONO_WEBHOOK_PUBLIC_KEY,
  });
}

let runtime: CommerceRuntime | undefined;

export function commerceRuntime(): CommerceRuntime {
  if (runtime) return runtime;
  const environment = readServerEnvironment();
  runtime = {
    config: commerceConfig(environment),
    database: productionDatabase(),
    provider: commercePaymentProvider(environment),
  };
  return runtime;
}
