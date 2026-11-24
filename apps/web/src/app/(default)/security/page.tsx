import { publicHref } from '@helvetly/i18n/public-href'
import {
  Fingerprint,
  FolderLock,
  type LucideIcon,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { TrustGrid } from '@/components/home/trust'
import { PageHero } from '@/components/page-hero'
import { Container } from '@/components/section'
import { cn } from '@/lib/cn'
import { languageOf, translatorFor } from '@/lib/i18n'
import { pageMetadata } from '@/lib/metadata'
import { type Tone, TONES } from '@/lib/tones'

type Props = { params: Promise<{ lang?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  return pageMetadata(
    lang,
    '/security',
    translate('securityAndPrivacy'),
    translate('metaSecurityDescription'),
  )
}

export default async function SecurityPage({ params }: Props) {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  // Each point describes what the code does today; see the contracts in docs/ before changing one.
  const SECTIONS: { title: string; icon: LucideIcon; tone: Tone; points: string[] }[] = [
    {
      title: translate('signingIn'),
      icon: Fingerprint,
      tone: 'lilac',
      points: [
        translate('noPasswordsPasskeysGoogleOrASixDigitCode'),
        translate('optionalTwoFactorAuthenticationWithAnAuthenticatorAppRecovery'),
        translate('everySignInIsItsOwnSessionWhichYou'),
        translate('theSessionCookieHoldsARandomTokenWeKeep'),
        translate('changesNeedAPerSessionCSRFTokenAndSign'),
      ],
    },
    {
      title: translate('yourRecords'),
      icon: ScrollText,
      tone: 'mint',
      points: [
        translate('workspacesAreIsolatedEveryQueryIsScopedToThe'),
        translate('financialChangesAreWrittenToAnAppendOnlyHash'),
        translate('closedMonthsCannotReceiveNewInvoicesPaymentsRefundsOr'),
        translate('invoiceNumbersAreGaplessPerSeriesAndYearAnd'),
        translate('deletingYourAccountKeepsYourCompanySFinancialHistory'),
      ],
    },
    {
      title: translate('files'),
      icon: FolderLock,
      tone: 'sky',
      points: [
        translate('everyUploadIsCheckedByTheSHA256Of'),
        translate('downloadsGoThroughShortLivedSignedLinksValidFor'),
        translate('signedDocumentsKeepAFrozenOriginalAndATamper'),
      ],
    },
    {
      title: translate('ai'),
      icon: Sparkles,
      tone: 'rose',
      points: [
        translate('aiModelQuestionsAndImportGoToOpenAI'),
        translate('heidiReadsOnlyWhatThePersonAskingMayRead'),
        translate('workspaceContentIsPassedToTheModelAsData'),
        translate('eachPlanHasAMonthlyAllowanceOfAITokens'),
      ],
    },
    {
      title: translate('privacy'),
      icon: ShieldCheck,
      tone: 'lemon',
      points: [
        translate('builtForTheSwissNDSGAndTheEUGDPR'),
        translate('noAnalyticsAdvertisingOrTrackingScriptsInThePlatform'),
        translate('anOwnerCanExportTheWholeWorkspaceAsA'),
        translate('secretsSuchAsTwoFactorKeysAndEInvoicing'),
      ],
    },
  ]
  return (
    <main>
      <PageHero
        eyebrow={translate('securityAndPrivacy')}
        title={
          <>
            {translate('yourBooksAreTheRecordOfYourCompany')}{' '}
            <span className="accent">{translate('weTreatThemThatWay')}</span>
          </>
        }
        lead={translate('whatHelvetlyDoesToKeepYourFinancialRecordsCorrect')}
      />
      <section className="pb-16">
        <Container>
          <TrustGrid lang={lang} />
        </Container>
      </section>
      <section className="py-16">
        <Container className="divide-site-line divide-y">
          {SECTIONS.map((section) => (
            <div
              key={section.title}
              data-reveal
              className="grid gap-6 py-10 md:grid-cols-[1fr_2fr]"
            >
              <h2 className="flex items-center gap-3 text-title font-semibold tracking-tight">
                <span
                  className={cn(
                    'inline-flex size-10 items-center justify-center rounded-xl text-white',
                    TONES[section.tone].solid,
                  )}
                >
                  <section.icon aria-hidden className="size-5" />
                </span>
                {section.title}
              </h2>
              <ul className="grid gap-3 text-body text-muted-foreground">
                {section.points.map((point) => (
                  <li key={point} className="flex gap-3">
                    <span
                      aria-hidden
                      className={cn('mt-2 size-1.5 shrink-0 rounded-full', TONES[section.tone].dot)}
                    />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="pt-10 text-body text-muted-foreground">
            {translate('theLegalSideIsInThe')}{' '}
            <Link
              href={publicHref('/privacy', lang)}
              className="text-link underline underline-offset-4 hover:no-underline"
            >
              {translate('privacyPolicy')}
            </Link>
            {translate('the')}{' '}
            <Link
              href={publicHref('/dpa', lang)}
              className="text-link underline underline-offset-4 hover:no-underline"
            >
              {translate('dataProcessingAgreement')}
            </Link>{' '}
            {translate('andThe')}{' '}
            <Link
              href={publicHref('/subprocessors', lang)}
              className="text-link underline underline-offset-4 hover:no-underline"
            >
              {translate('listOfSubprocessors')}
            </Link>
            .
          </p>
        </Container>
      </section>
    </main>
  )
}
