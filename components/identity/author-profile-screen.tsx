import { AuroraField } from "../aurora";

import { AuthorProfileSubmitControl } from "./form-submit-controls";
import { IdentityNotice, IdentityShell } from "./identity-shell";
import styles from "./identity.module.css";

export interface AuthorProfileScreenProps {
  action?: string | ((formData: FormData) => void | Promise<void>);
  csrfToken?: string;
  defaultValue?: string;
  fieldError?: string;
  formError?: string;
  homeHref?: string;
  method?: "get" | "post";
  saved?: boolean;
  saving?: boolean;
}

export function AuthorProfileScreen({
  action,
  csrfToken,
  defaultValue,
  fieldError,
  formError,
  homeHref,
  method = "post",
  saved = false,
  saving = false,
}: AuthorProfileScreenProps) {
  return (
    <IdentityShell
      description="Вкажіть публічне ім’я або псевдонім для книжок у каталозі."
      headingId="identity-author-profile-title"
      homeHref={homeHref}
      title="Профіль автора"
    >
      {saved ? (
        <IdentityNotice tone="success">Публічне ім’я збережено.</IdentityNotice>
      ) : null}
      {formError ? <IdentityNotice tone="error">{formError}</IdentityNotice> : null}

      <form action={action} className={styles.profileForm} method={method}>
        {csrfToken ? <input name="csrfToken" type="hidden" value={csrfToken} /> : null}
        <AuroraField
          autoComplete="nickname"
          autoFocus={Boolean(fieldError)}
          defaultValue={defaultValue}
          description="Так це ім'я виглядатиме у книгарні"
          error={fieldError}
          id="author-public-name"
          label="Публічне ім’я або псевдонім"
          name="publicName"
          readOnly={saving}
          required
        />

        <p className={styles.privacyNote}>
          Договірні, платіжні й податкові дані зберігаються окремо та не показуються у
          книгарні.
        </p>

        <AuthorProfileSubmitControl forcedBusy={saving} />
      </form>
    </IdentityShell>
  );
}
