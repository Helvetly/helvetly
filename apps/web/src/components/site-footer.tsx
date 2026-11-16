import { type Locale, localizedHref } from '@helvetly/i18n'
import { Flag } from '@helvetly/ui/components/flag'
import { LanguageSwitcher } from '@helvetly/ui/components/language-switcher'
import { Logo } from '@helvetly/ui/components/logo'
import { ThemeToggle } from '@helvetly/ui/components/theme-toggle'
import { Bell, CircleCheck, Landmark, type LucideIcon } from 'lucide-react'
import Link from 'next/link'

import { Cta } from '@/components/cta'
import { Ridge } from '@/components/ridge'
import { Container } from '@/components/section'
import { translatorFor } from '@/lib/i18n'
import { TRIAL_DAYS } from '@/lib/plans'
import { siteIn } from '@/lib/site'

// The page is built ahead of time, so the year is the build's.
const YEAR = new Date().getFullYear()

/** The finale on every page: the invitation, then the site's links, in one night-sky card. */
export function SiteFooter({ lang }: { lang: Locale }) {
  const translate = translatorFor(lang)
  const { FOOTER, START_URL } = siteIn(lang)
  // What a Friday looks like with Helvetly: three things that got done on their own.
  const DONE: { icon: LucideIcon; title: string; meta: string; tone: string; tilt: string }[] = [
    {
      icon: CircleCheck,
      title: translate('invoice20260418Paid'),
      meta: translate('alpenglHnGmbHCHF486000'),
      tone: 'from-mint-solid to-sky-solid',
      tilt: '-rotate-3 sm:translate-x-6',
    },
    {
      icon: Bell,
      title: translate('firstReminderSent'),
      meta: translate('rheinConsultingAGWithQRBill'),
      tone: 'from-peach-solid to-rose-solid',
      tilt: 'rotate-2 sm:-translate-x-4',
    },
    {
      icon: Landmark,
      title: translate('vatReturnReady'),
      meta: translate('q42026ECH0217FileForTheEPortal'),
      tone: 'from-lilac-solid to-heidi-to',
      tilt: '-rotate-1 sm:translate-x-10',
    },
  ]
  return (
    <footer className="relative mt-32 sm:mt-48">
      <Ridge edge="rise" />
      <div className="dark night relative overflow-hidden text-white">
        <div aria-hidden className="dot-field absolute inset-0 mask-t-from-70% opacity-30" />
        <div aria-hidden className="beams beam absolute -top-1/2 -right-1/4 size-[60rem]" />
        {/* The sky starts flat where the dusk ends, so the two never show a seam. */}
        <div
          aria-hidden
          className="from-night-2 absolute inset-x-0 top-0 h-40 bg-linear-to-b to-transparent"
        />

        <Container className="relative grid grid-cols-1 items-center gap-14 pt-20 pb-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:pt-24">
          <div data-reveal className="flex flex-col items-start">
            <h2 className="text-subhero font-semibold text-balance">
              {translate('spendFridayOnYourBusiness')}{' '}
              <span className="accent ink-gradient pr-2">{translate('notOnPaperwork')}</span>
            </h2>
            <p className="text-lead mt-6 max-w-xl text-balance text-white/70">
              {translate('startWithA')}
              {TRIAL_DAYS}
              {translate('dayTrialBringYourDataWithTheAIImport')}
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Cta href={START_URL}>{translate('startYourFreeTrial')}</Cta>
              <Cta
                href={localizedHref('/pricing', lang)}
                variant="outline"
                className="border-white/15 bg-white/5 text-white hover:border-white/30 hover:bg-white/10"
              >
                {translate('comparePlans')}
              </Cta>
            </div>
            <p className="mt-5 text-body-sm text-white/50">
              {TRIAL_DAYS}
              {translate('dayTrialCancelAnyTimePricesInCHFEUR')}
            </p>
          </div>

          <ul
            aria-label={translate('doneOnItsOwn')}
            className="relative mx-auto grid w-full max-w-sm grid-cols-1 gap-4 py-4"
          >
            {DONE.map(({ icon: Icon, title, meta, tone, tilt }, i) => (
              <li key={title} data-reveal style={{ ['--d' as string]: `${150 + i * 150}ms` }}>
                <div
                  style={{ animationDelay: `${-i * 2}s` }}
                  className={`animate-float flex items-center gap-3 rounded-2xl border border-white/12 bg-white/[0.07] p-3.5 backdrop-blur-xl ${tilt}`}
                >
                  <span
                    className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br text-white ${tone}`}
                  >
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body font-semibold">{title}</span>
                    <span className="block truncate text-body-sm text-white/60">{meta}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Container>

        <Container className="relative border-t border-white/10 py-10">
          <div className="grid grid-cols-2 gap-10 md:grid-cols-3 lg:grid-cols-5">
            {FOOTER.map((group) => (
              <nav key={group.title} aria-label={group.title} className="flex flex-col gap-2">
                <h2 className="text-body-sm font-medium text-white">{group.title}</h2>
                {group.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="w-fit text-body-sm text-white/55 underline-offset-4 transition-colors hover:text-white hover:underline"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            ))}
          </div>
          <div className="mt-10 flex flex-col gap-2 text-body-sm text-white/45 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <p className="inline-flex items-center gap-2">
                <Logo className="size-5" />
                <span>
                  © {YEAR}
                  {translate('helvetly2')}
                </span>
              </p>
              <p className="inline-flex items-center gap-2">
                <Flag region="CH" className="size-4 rounded-xs" />
                {translate('madeInSwitzerland')}
              </p>
            </div>
            <div className="flex items-center gap-4 sm:justify-end">
              <LanguageSwitcher />
              <ThemeToggle className="bg-white/8" />
            </div>
          </div>
        </Container>
      </div>
    </footer>
  )
}
