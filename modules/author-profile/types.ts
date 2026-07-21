export interface AuthorProfile {
  readonly authorId: string;
  readonly publicName: string;
}

export interface PublicNameValidationResult {
  readonly error?: string;
  readonly value?: string;
}

const unsafeNameCharacters = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;

export function validatePublicName(candidate: unknown): PublicNameValidationResult {
  if (typeof candidate !== "string") {
    return { error: "Укажіть публічне ім’я або псевдонім." };
  }
  const value = candidate.trim().replace(/\s+/gu, " ");
  const codePointLength = Array.from(value).length;
  if (codePointLength < 2) {
    return { error: "Ім’я має містити щонайменше 2 символи." };
  }
  if (codePointLength > 120) {
    return { error: "Ім’я має містити не більше 120 символів." };
  }
  if (unsafeNameCharacters.test(value)) {
    return { error: "Ім’я містить неприпустимі службові символи." };
  }
  return { value };
}
