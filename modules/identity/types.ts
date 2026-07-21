export const OAUTH_PROVIDERS = ["google", "facebook"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

export const USER_ROLES = ["buyer", "author", "manager"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AuthSession {
  readonly authorOnboarding: boolean;
  readonly expiresAt: string;
  readonly roles: readonly UserRole[];
  readonly sessionId: string;
  readonly userId: string;
}

export type AuthIntent = "default" | "author_onboarding";

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return OAUTH_PROVIDERS.includes(value as OAuthProviderId);
}

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}
