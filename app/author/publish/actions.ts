"use server";

import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";

import { assertSameOriginMutation } from "../../../modules/identity/server/http";
import { currentSessionContext } from "../../../modules/identity/server/next-session";
import { identityRuntime } from "../../../modules/identity/server/runtime";
import { assertValidCsrf } from "../../../modules/identity/server/session";
import {
  createAuthorDraft,
  generateFallbackCover,
  PublishingConflictError,
  PublishingInputError,
  queueDraftConversion,
  saveCommerceStep,
  saveDescriptionStep,
  saveSampleSection,
  submitBookDraft,
} from "../../../modules/publishing/server/service";
import { publishingPrivateObjectStorage } from "../../../modules/publishing/storage/runtime";

async function authorMutationContext(formData: FormData) {
  const runtime = identityRuntime();
  try {
    assertSameOriginMutation(await headers(), runtime.config.appOrigin);
  } catch {
    redirect("/author/books?error=request_rejected");
  }
  const context = await currentSessionContext();
  if (!context) redirect("/login?returnTo=%2Fauthor%2Fbooks&intent=author");
  if (!context.session.roles.includes("author")) forbidden();
  try {
    assertValidCsrf(formData.get("csrfToken"), context, runtime.config);
  } catch {
    redirect("/author/books?error=request_rejected");
  }
  return { context, runtime };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function integer(formData: FormData, name: string): number {
  const raw = text(formData, name).trim();
  if (!/^-?\d+$/u.test(raw)) return -1;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : -1;
}

function priceKopiykas(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,7}(?:\.\d{1,2})?$/u.test(normalized)) return -1;
  const [hryvnias, kopiykas = ""] = normalized.split(".");
  return Number(hryvnias) * 100 + Number(kopiykas.padEnd(2, "0"));
}

function errorCode(error: unknown): string {
  if (error instanceof PublishingInputError) return error.code.toLocaleLowerCase("en-US");
  if (error instanceof PublishingConflictError) return "conflict";
  return "save_failed";
}

function publishUrl(draftId: string, step: number, error?: string): string {
  const query = new URLSearchParams({ draft: draftId, step: String(step) });
  if (error) query.set("error", error);
  return `/author/publish?${query.toString()}`;
}

function previewUrl(draftId: string, error?: string): string {
  const query = new URLSearchParams({ draft: draftId });
  if (error) query.set("error", error);
  return `/author/publish/preview?${query.toString()}`;
}

export async function createDraftAction(formData: FormData): Promise<void> {
  const { context, runtime } = await authorMutationContext(formData);
  const draft = await createAuthorDraft(
    runtime.database,
    publishingPrivateObjectStorage(),
    context.session.userId,
  );
  redirect(`${publishUrl(draft.draftId, 1)}&created=1`);
}

export async function saveDescriptionStepAction(formData: FormData): Promise<void> {
  const { context, runtime } = await authorMutationContext(formData);
  const draftId = text(formData, "draftId");
  try {
    await saveDescriptionStep(runtime.database, {
      authorId: context.session.userId,
      description: text(formData, "description"),
      draftId,
      expectedRevision: integer(formData, "revision"),
      title: text(formData, "title"),
    });
  } catch (error) {
    redirect(publishUrl(draftId, 2, errorCode(error)));
  }
  redirect(`${publishUrl(draftId, 3)}&saved=1`);
}

export async function generateFallbackCoverAction(formData: FormData): Promise<void> {
  const { context, runtime } = await authorMutationContext(formData);
  const draftId = text(formData, "draftId");
  try {
    await generateFallbackCover(runtime.database, publishingPrivateObjectStorage(), {
      authorId: context.session.userId,
      draftId,
    });
  } catch (error) {
    redirect(publishUrl(draftId, 3, errorCode(error)));
  }
  redirect(`${publishUrl(draftId, 4)}&saved=1`);
}

export async function saveCommerceStepAction(formData: FormData): Promise<void> {
  const { context, runtime } = await authorMutationContext(formData);
  const draftId = text(formData, "draftId");
  try {
    await saveCommerceStep(runtime.database, publishingPrivateObjectStorage(), {
      authorId: context.session.userId,
      basePriceKopiykas: priceKopiykas(text(formData, "price")),
      draftId,
      expectedRevision: integer(formData, "revision"),
      genreSlug: text(formData, "genre"),
    });
    await queueDraftConversion(runtime.database, {
      authorId: context.session.userId,
      draftId,
    });
  } catch (error) {
    redirect(publishUrl(draftId, 4, errorCode(error)));
  }
  redirect(`/author/publish/preview?draft=${encodeURIComponent(draftId)}`);
}

export async function saveSampleSectionAction(formData: FormData): Promise<void> {
  const { context, runtime } = await authorMutationContext(formData);
  const draftId = text(formData, "draftId");
  try {
    await saveSampleSection(runtime.database, publishingPrivateObjectStorage(), {
      authorId: context.session.userId,
      draftId,
      previewArtifactId: text(formData, "previewArtifactId"),
      sampleSectionIndex: integer(formData, "sampleSectionIndex"),
    });
  } catch (error) {
    redirect(previewUrl(draftId, errorCode(error)));
  }
  redirect(`${publishUrl(draftId, 6)}&saved=1`);
}

export async function retryConversionAction(formData: FormData): Promise<void> {
  const { context, runtime } = await authorMutationContext(formData);
  const draftId = text(formData, "draftId");
  let conversionRunId: string;
  try {
    conversionRunId = await queueDraftConversion(runtime.database, {
      authorId: context.session.userId,
      draftId,
    });
  } catch (error) {
    redirect(`${publishUrl(draftId, 4, errorCode(error))}`);
  }
  const query = new URLSearchParams({ draft: draftId, retry: conversionRunId });
  redirect(`/author/publish/preview?${query.toString()}`);
}

export async function submitBookDraftAction(formData: FormData): Promise<void> {
  const { context, runtime } = await authorMutationContext(formData);
  const draftId = text(formData, "draftId");
  try {
    await submitBookDraft(runtime.database, publishingPrivateObjectStorage(), {
      authorId: context.session.userId,
      draftId,
      fiveYearLicenseConfirmed: formData.get("fiveYearLicenseConfirmed") === "on",
      rightsConfirmed: formData.get("rightsConfirmed") === "on",
    });
  } catch (error) {
    redirect(publishUrl(draftId, 6, errorCode(error)));
  }
  redirect("/author/books?submitted=1");
}
