import {
  ArchiveRestore,
  Fingerprint,
  Link2,
  Lock,
  type LucideIcon,
  ShieldCheck,
  EyeOff,
} from 'lucide-react'
import Link from 'next/link'

import { Container, SectionHeading } from '@/components/section'
import { cn } from '@/lib/cn'
import { translate } from '@/lib/i18n'
import { type Tone, TONES } from '@/lib/tones'

const TRUST: { icon: LucideIcon; tone: Tone; title: string; body: string }[] = [
  {
    icon: Fingerprint,
    tone: 'lilac',
    title: translate('noPasswordsToSteal'),
    body: translate('signInWithAPasskeyGoogleOrAnEmailed'),
  },
  {
    icon: Link2,
    tone: 'mint',
    title: translate('aTamperEvidentLedger'),
    body: translate('everyFinancialChangeIsWrittenToAnAppendOnly'),
  },
  {
    icon: Lock,
    tone: 'sky',
    title: translate('closedMonthsStayClosed'),
    body: translate('closeAPeriodAndNobodyCanIssuePayOr'),
  },
  {
    icon: ArchiveRestore,
    tone: 'peach',
    title: translate('yourDataYoursToTake'),
    body: translate('anOwnerCanDownloadTheWholeWorkspaceAsA'),
  },
  {
    icon: EyeOff,
    tone: 'rose',
    title: translate('noTrackersNoAds'),
    body: translate('thePlatformRunsWithoutAnalyticsOrAdvertisingScriptsFonts'),
  },
  {
    icon: ShieldCheck,
    tone: 'lemon',
    title: translate('builtForNDSGAndGDPR'),
    body: translate('aDataProcessingAgreementAPublicListOfSubprocessors'),
  },
]

export function Trust() {
  return (
    <section className="relative py-14 sm:py-20">
      <div aria-hidden className="wash absolute inset-0 -z-10 mask-y-from-75% mask-y-to-100%" />
      <Container>
        <SectionHeading
          eyebrow={translate('securityAndPrivacy')}
          tone="lilac"
          title={
            <>
              {translate('swissAboutThe')}
              <span className="accent">{translate('details')}</span>
            </>
          }
          lead={translate('yourBooksAreTheRecordOfYourCompanyHelvetly')}
        />
        <TrustGrid className="mt-16" />
        <p data-reveal className="mt-8 text-center text-body text-muted-foreground">
          {translate('readMoreAbout')}{' '}
          <Link
            href="/security"
            className="text-link underline underline-offset-4 hover:no-underline"
          >
            {translate('howWeProtectYourData')}
          </Link>
          .
        </p>
      </Container>
    </section>
  )
}

/** The six promises as toned cards; the home page and /security share them. */
export function TrustGrid({ className }: { className?: string }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {TRUST.map(({ icon: Icon, tone, title, body }, i) => (
        <div
          key={title}
          data-reveal
          style={{ ['--d' as string]: `${(i % 3) * 90}ms` }}
          className="border-site-line bg-site/80 rounded-3xl border p-7 backdrop-blur transition-colors hover:border-foreground/15"
        >
          <span
            className={cn(
              'inline-flex size-10 items-center justify-center rounded-xl',
              TONES[tone].surface,
              TONES[tone].ink,
            )}
          >
            <Icon aria-hidden className="size-5" />
          </span>
          <h3 className="mt-4 text-title-sm font-semibold">{title}</h3>
          <p className="mt-1.5 text-body text-muted-foreground">{body}</p>
        </div>
      ))}
    </div>
  )
}
