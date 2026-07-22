import { ArrowLeft, ArrowRight, BookOpenText, Check, ImageSquare, MagicWand } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";

import {
  generateFallbackCoverAction,
  saveCommerceStepAction,
  saveDescriptionStepAction,
  submitBookDraftAction,
} from "../../app/author/publish/actions";
import type { BookDraftReadModel, PublishingGenre, PublishingPriceHint } from "../../modules/publishing/types";
import { AuroraButton } from "../aurora";

import { AuthorShell } from "./author-shell";
import { PublishingErrorNotice } from "./error-notice";
import { LegalConfirmations } from "./legal-confirmations";
import styles from "./publishing.module.css";
import { GoogleDocsImporter, UploadDropzone } from "./upload-dropzone";

const steps = [
  "Рукопис",
  "Опис та ілюстрації",
  "Обкладинка",
  "Жанр і ціна",
  "Перегляд",
  "Права й ліцензія",
] as const;

interface PublishWizardProps {
  readonly csrfToken: string;
  readonly draft: BookDraftReadModel;
  readonly error?: string;
  readonly genres: readonly PublishingGenre[];
  readonly priceHint: PublishingPriceHint;
  readonly saved?: boolean;
  readonly step: number;
}

function Stepper({ draftId, step }: { readonly draftId: string; readonly step: number }) {
  return (
    <>
      <ol aria-label="Кроки публікації" className={styles.stepper}>
        {steps.map((label, index) => {
          const number = index + 1;
          const className = number === step ? styles.active : number < step ? styles.complete : "";
          return (
            <li aria-current={number === step ? "step" : undefined} className={className} key={label}>
              {number < step ? (
                <Link href={`/author/publish?draft=${encodeURIComponent(draftId)}&step=${number}`}>
                  <span className={styles.stepNumber}><Check aria-hidden="true" size={16} /></span><span>{label}</span>
                </Link>
              ) : (
                <><span className={styles.stepNumber}>{number}</span><span>{label}</span></>
              )}
            </li>
          );
        })}
      </ol>
      <div className={styles.mobileStep}>
        <span>Крок {step} з 6 · {steps[step - 1]}</span>
        <span aria-hidden="true" className={styles.progressTrack}><span style={{ width: `${(step / 6) * 100}%` }} /></span>
      </div>
    </>
  );
}

function Actions({ backHref, children }: { readonly backHref?: string; readonly children: React.ReactNode }) {
  return (
    <div className={styles.wizardActions}>
      {backHref ? <Link className={styles.textLink} href={backHref}><ArrowLeft aria-hidden="true" size={17} /> Назад</Link> : <span />}
      <div className={styles.actionsRight}>
        <Link className={styles.textLink} href="/author/books">Зберегти й вийти</Link>
        {children}
      </div>
    </div>
  );
}

function StepOne({ csrfToken, draft }: { readonly csrfToken: string; readonly draft: BookDraftReadModel }) {
  return (
    <>
      <header className={styles.stepHeader}>
        <p className={styles.eyebrow}>Крок 1</p><h2 id="wizard-step-title">Завантажте рукопис</h2>
        <p>Ми виправимо лише технічні речі: зайві пробіли, порожні рядки, типові лапки й тире. Зміст і авторський голос не переписуються.</p>
      </header>
      {draft.sourceName ? <div className={styles.inlineSuccess} role="status">Поточний рукопис: {draft.sourceName}</div> : null}
      <UploadDropzone
        accept=".docx,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        apiUrl={`/api/author/publishing/drafts/${draft.draftId}/manuscript`}
        csrfToken={csrfToken}
        description="DOCX або TXT до 50 МБ. Ілюстрації всередині DOCX залишаться у потоці тексту."
        kind="manuscript"
        label="Перетягніть DOCX або TXT сюди"
        nextHref={`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=2&saved=1`}
      />
      <div className={styles.divider}>або</div>
      <GoogleDocsImporter
        apiUrl={`/api/author/publishing/drafts/${draft.draftId}/google-docs`}
        csrfToken={csrfToken}
        nextHref={`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=2&saved=1`}
      />
      {draft.manuscriptObjectId ? (
        <Actions>
          <Link
            className={styles.primaryLink}
            href={`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=2`}
          >
            Далі <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </Actions>
      ) : null}
    </>
  );
}

function StepTwo({ csrfToken, draft }: { readonly csrfToken: string; readonly draft: BookDraftReadModel }) {
  return (
    <>
      <header className={styles.stepHeader}>
        <p className={styles.eyebrow}>Крок 2</p><h2 id="wizard-step-title">Назва, опис та ілюстрації</h2>
        <p>Назва потрібна для обкладинки й Сторінки книжки. Окремі ілюстрації додаємо за визначеним якорем, не змінюючи текст.</p>
      </header>
      <form action={saveDescriptionStepAction} className={styles.formStack}>
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="draftId" type="hidden" value={draft.draftId} />
        <input name="revision" type="hidden" value={draft.revision} />
        <div className={styles.field}>
          <label htmlFor="book-title">Назва книжки *</label>
          <input defaultValue={draft.title === "Нова книжка" ? "" : draft.title} id="book-title" maxLength={240} name="title" required />
        </div>
        <div className={styles.field}>
          <label htmlFor="book-description">Опис *</label>
          <textarea aria-describedby="book-description-help" defaultValue={draft.description} id="book-description" maxLength={8000} name="description" required />
          <span className={styles.fieldHelp} id="book-description-help">Коротко поясніть читачеві, про що книжка. До 8 000 символів.</span>
        </div>
        {draft.illustrations.length ? (
          <ul aria-label="Додані ілюстрації" className={styles.illustrationList}>
            {draft.illustrations.map((illustration) => (
              <li className={styles.illustrationItem} key={illustration.id}>
                <Image alt="" height={48} src={illustration.url} unoptimized width={48} />
                <span><strong>{illustration.name}</strong><br /><span className={styles.fieldHelp}>{illustration.anchorLabel}</span></span>
              </li>
            ))}
          </ul>
        ) : null}
        <UploadDropzone
          accept="image/png,image/jpeg,image/webp"
          anchorLabel="Після першого розділу"
          apiUrl={`/api/author/publishing/drafts/${draft.draftId}/illustrations`}
          csrfToken={csrfToken}
          description="PNG, JPG або WebP. За замовчуванням — після першого розділу; позицію буде видно в preview."
          kind="illustration"
          label="Додати окрему ілюстрацію"
          nextHref={`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=2&saved=1&uploaded=illustration`}
        />
        <Actions backHref={`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=1`}>
          <AuroraButton type="submit">Далі <ArrowRight aria-hidden="true" size={18} /></AuroraButton>
        </Actions>
      </form>
    </>
  );
}

function StepThree({ csrfToken, draft }: { readonly csrfToken: string; readonly draft: BookDraftReadModel }) {
  return (
    <>
      <header className={styles.stepHeader}>
        <p className={styles.eyebrow}>Крок 3</p><h2 id="wizard-step-title">Обкладинка</h2>
        <p>Завантажте готове artwork або створіть просту raster-обкладинку. Назва буде запечена у файл, а кути залишаться прямими.</p>
      </header>
      {draft.coverUrl ? (
        <div className={styles.coverCurrent}>
          <Image alt={`${draft.title} — обкладинка`} className={styles.coverPreview} height={270} src={draft.coverUrl} unoptimized width={180} />
          <div><strong>Обкладинка готова</strong><p className={styles.fieldHelp}>{draft.coverMode === "fallback" ? "Створена з шаблону UkieBook" : "Завантажена вами"}. Можна замінити нижче.</p></div>
        </div>
      ) : null}
      <div className={styles.choiceGrid}>
        <div className={styles.choice}>
          <ImageSquare aria-hidden="true" size={30} />
          <strong>Завантажити готову</strong>
          <UploadDropzone
            accept="image/png,image/jpeg,image/webp"
            apiUrl={`/api/author/publishing/drafts/${draft.draftId}/cover`}
            csrfToken={csrfToken}
            description="PNG, JPG або WebP. Файл буде приведено до 2:3."
            kind="cover"
            label="Обрати artwork"
            nextHref={`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=4&saved=1`}
          />
        </div>
        <form action={generateFallbackCoverAction} className={styles.choice}>
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="draftId" type="hidden" value={draft.draftId} />
          <MagicWand aria-hidden="true" size={30} />
          <strong>Створити просту</strong>
          <span className={styles.fieldHelp}>Шаблон із назвою, автором і жанром; результат — справжній PNG.</span>
          <AuroraButton variant="secondary" type="submit">Створити обкладинку</AuroraButton>
        </form>
      </div>
      <Actions backHref={`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=2`}>
        {draft.coverUrl ? <Link className={styles.primaryLink} href={`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=4`}>Далі <ArrowRight aria-hidden="true" size={18} /></Link> : <span />}
      </Actions>
    </>
  );
}

function StepFour({ csrfToken, draft, genres, priceHint }: Pick<PublishWizardProps, "csrfToken" | "draft" | "genres" | "priceHint">) {
  return (
    <>
      <header className={styles.stepHeader}>
        <p className={styles.eyebrow}>Крок 4</p><h2 id="wizard-step-title">Жанр і ціна</h2>
        <p>Оберіть один основний жанр і встановіть базову ціну в гривні. Безкоштовний фрагмент оберете з реальних розділів після підготовки видання.</p>
      </header>
      <form action={saveCommerceStepAction} className={styles.formStack}>
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="draftId" type="hidden" value={draft.draftId} />
        <input name="revision" type="hidden" value={draft.revision} />
        <div className={styles.field}>
          <label htmlFor="genre">Основний жанр *</label>
          <select defaultValue={draft.genreSlug ?? ""} id="genre" name="genre" required>
            <option disabled value="">Оберіть жанр</option>
            {genres.map((genre) => <option key={genre.slug} value={genre.slug}>{genre.label}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="price">Базова ціна, грн *</label>
          <input aria-describedby="price-help" defaultValue={draft.basePriceKopiykas === null ? "" : (draft.basePriceKopiykas / 100).toFixed(2)} id="price" inputMode="decimal" name="price" placeholder="199" required />
          <span className={styles.fieldHelp} id="price-help">Поточний конфігурований орієнтир: {(priceHint.minKopiykas / 100).toLocaleString("uk-UA")}–{(priceHint.maxKopiykas / 100).toLocaleString("uk-UA")} грн. Остаточну ціну встановлюєте ви.</span>
        </div>
        <Actions backHref={`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=3`}>
          <AuroraButton type="submit"><BookOpenText aria-hidden="true" size={18} /> Підготувати preview</AuroraButton>
        </Actions>
      </form>
    </>
  );
}

function StepSix({ csrfToken, draft }: { readonly csrfToken: string; readonly draft: BookDraftReadModel }) {
  return (
    <>
      <header className={styles.stepHeader}>
        <p className={styles.eyebrow}>Крок 6</p><h2 id="wizard-step-title">Права й ліцензія</h2>
        <p>Це два різні рішення. Прочитайте наслідки й підтвердьте кожне окремо — чекбокси не позначені наперед.</p>
      </header>
      <LegalConfirmations action={submitBookDraftAction} csrfToken={csrfToken} draftId={draft.draftId} />
      <Actions backHref={`/author/publish/preview?draft=${encodeURIComponent(draft.draftId)}`}><span /></Actions>
    </>
  );
}

export function PublishWizard({ csrfToken, draft, error, genres, priceHint, saved, step }: PublishWizardProps) {
  return (
    <AuthorShell active="publish" csrfToken={csrfToken}>
      <div className={styles.wizardFrame}>
        <header className={styles.wizardHeading}>
          <p className={styles.eyebrow}>Майстер публікації</p>
          <h1>Нова книжка</h1>
          <p>Від рукопису до подання — шість послідовних кроків без технічних знань.</p>
          <span className={styles.draftStatus}><Check aria-hidden="true" size={15} /> {saved ? "Чернетка збережена щойно" : "Чернетка збережена"}</span>
        </header>
        <Stepper draftId={draft.draftId} step={step} />
        {error ? <PublishingErrorNotice message={error} /> : null}
        <section aria-labelledby="wizard-step-title" className={[styles.panel, styles.wizardPanel].join(" ")}>
          {step === 1 ? <StepOne csrfToken={csrfToken} draft={draft} /> : null}
          {step === 2 ? <StepTwo csrfToken={csrfToken} draft={draft} /> : null}
          {step === 3 ? <StepThree csrfToken={csrfToken} draft={draft} /> : null}
          {step === 4 ? <StepFour csrfToken={csrfToken} draft={draft} genres={genres} priceHint={priceHint} /> : null}
          {step === 5 ? <div className={styles.pendingState}><div><h2 id="wizard-step-title">Попередній перегляд</h2><p>Відкрийте робочий простір, щоб перевірити адаптивне видання і Сторінку книжки.</p><Link className={styles.primaryLink} href={`/author/publish/preview?draft=${encodeURIComponent(draft.draftId)}`}>Відкрити preview</Link></div></div> : null}
          {step === 6 ? <StepSix csrfToken={csrfToken} draft={draft} /> : null}
        </section>
      </div>
    </AuthorShell>
  );
}
