export const PUBLISHING_SCHEMA_VERSION = 1 as const;
export const PUBLISHING_PIPELINE_VERSION = 1 as const;
export const PUBLISHING_CONVERTER_ADAPTER_ID = "calibre-legacy-mobi-v1" as const;

export type PublishingBookStatus =
  | "draft"
  | "submitted"
  | "manual_review"
  | "rejected"
  | "published";

export type PublishingDraftStatus =
  | "draft"
  | "converting"
  | "conversion_failed"
  | "ready"
  | "submitted";

export type PublishingPrivateObjectKind =
  | "manuscript"
  | "illustration"
  | "cover"
  | "normalized"
  | "preview"
  | "epub"
  | "mobi";

export type ManuscriptSourceType = "txt" | "docx" | "google_docs";

export interface PublishingPrivateObject {
  readonly id: string;
  readonly ownerUserId: string;
  readonly kind: PublishingPrivateObjectKind;
  readonly storageKey: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly originalName: string | null;
  readonly createdAt: string;
}

export interface PreviewParagraphBlock {
  readonly kind: "paragraph";
  readonly text: string;
}

export interface PreviewIllustrationBlock {
  readonly kind: "illustration";
  readonly objectId: string;
  readonly alt: string;
}

export interface PreviewSection {
  readonly heading: string;
  readonly blocks: readonly (PreviewParagraphBlock | PreviewIllustrationBlock)[];
}

export interface PreviewDocument {
  readonly schemaVersion: typeof PUBLISHING_SCHEMA_VERSION;
  readonly title: string;
  readonly authorPublicName: string;
  readonly sections: readonly PreviewSection[];
}

export interface PublishingIllustrationReadModel {
  readonly id: string;
  readonly objectId: string;
  readonly name: string;
  readonly ordinal: number;
  readonly anchorLabel: string;
  readonly url: string;
}

export interface PublishingPreviewReadModel {
  readonly artifactId: string;
  readonly createdAt: string;
  readonly document: PreviewDocument;
  readonly epubObjectId: string;
  readonly mobiObjectId: string;
}

export interface BookDraftReadModel {
  readonly schemaVersion: typeof PUBLISHING_SCHEMA_VERSION;
  readonly bookId: string;
  readonly draftId: string;
  readonly authorId: string;
  readonly authorPublicName: string;
  readonly revision: number;
  readonly currentStep: number;
  readonly status: PublishingDraftStatus;
  readonly title: string;
  readonly description: string;
  readonly sourceType: ManuscriptSourceType | null;
  readonly sourceName: string | null;
  readonly sourceReference: string | null;
  readonly manuscriptObjectId: string | null;
  readonly illustrations: readonly PublishingIllustrationReadModel[];
  readonly genreSlug: string | null;
  readonly basePriceKopiykas: number | null;
  readonly sampleSectionIndex: number | null;
  readonly samplePreviewArtifactId: string | null;
  readonly coverMode: "uploaded" | "fallback";
  readonly coverObjectId: string | null;
  readonly coverUrl: string | null;
  readonly conversionFailure: null | {
    readonly code: string;
    readonly message: string;
  };
  readonly preview: PublishingPreviewReadModel | null;
  readonly updatedAt: string;
}

export interface AuthorBookListItem {
  readonly id: string;
  readonly draftId: string | null;
  readonly currentStep: number | null;
  readonly draftStatus: PublishingDraftStatus | null;
  readonly title: string;
  readonly status: PublishingBookStatus;
  readonly rejectionCategory: string | null;
  readonly coverUrl: string | null;
  readonly updatedAt: string;
  readonly salesCount: number | null;
}

export interface PublishingGenre {
  readonly slug: string;
  readonly label: string;
}

export interface PublishingPriceHint {
  readonly minKopiykas: number;
  readonly maxKopiykas: number;
}

export const RIGHTS_COPY_VERSION = 1 as const;
export const FIVE_YEAR_LICENSE_COPY_VERSION = 1 as const;

export const SAFE_CONVERSION_MESSAGES: Readonly<Record<string, string>> = {
  CALIBRE_UNAVAILABLE:
    "Сервіс конвертації тимчасово недоступний. Чернетку збережено — спробуйте ще раз.",
  BROKEN_MANUSCRIPT:
    "Не вдалося прочитати рукопис. Завантажте справний DOCX або TXT.",
  EPUB_INVALID:
    "EPUB не пройшов технічну перевірку. Чернетку збережено.",
  MOBI_INVALID:
    "MOBI не пройшов технічну перевірку. Чернетку збережено.",
  STALE_CONVERSION: "Рукопис змінився під час обробки. Запустіть перегляд ще раз.",
  UNKNOWN: "Не вдалося підготувати видання. Чернетку збережено.",
};

export function safeConversionMessage(code: string): string {
  return SAFE_CONVERSION_MESSAGES[code] ?? SAFE_CONVERSION_MESSAGES.UNKNOWN!;
}
