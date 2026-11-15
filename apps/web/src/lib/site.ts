import { defaultLocale, languageHref, locale } from '@helvetly/i18n'

import { COMPETITORS } from '@/lib/compare'
import { translate } from '@/lib/i18n'

export const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL ?? 'http://localhost:8000'
// Sign-in is passwordless and makes the account on first use, so starting and signing in share a page.
export const SIGN_IN_URL = `${PLATFORM_URL}${locale === defaultLocale ? '/login' : languageHref('/login', locale)}`
export const START_URL = SIGN_IN_URL

export const NAV = [
  { href: '/#features', label: translate('product') },
  { href: '/pricing', label: translate('pricing') },
  { href: '/compare', label: translate('compare') },
  { href: '/security', label: translate('security') },
  { href: '/guides', label: translate('guides') },
  { href: '/help', label: translate('help2') },
]

export const FOOTER = [
  {
    title: translate('product'),
    links: [
      { href: '/#features', label: translate('features') },
      { href: '/#heidi', label: translate('heidiTheAssistant') },
      { href: '/pricing', label: translate('pricing') },
      { href: '/pricing#compare-plans', label: translate('comparePlans') },
    ],
  },
  {
    title: translate('whyHelvetly'),
    links: [
      { href: '/security', label: translate('securityAndPrivacy') },
      { href: '/#faq', label: translate('questions') },
    ],
  },
  {
    title: translate('resources'),
    links: [
      { href: '/guides', label: translate('guides') },
      { href: '/guides/swiss-vat', label: translate('swissVATExplained') },
      { href: '/guides/qr-bill', label: translate('theSwissQRBill') },
      { href: '/guides/payment-reminders', label: translate('paymentReminders') },
      { href: '/help', label: translate('helpCenter') },
    ],
  },
  {
    title: translate('comparisons'),
    links: COMPETITORS.map(({ slug, name }) => ({
      href: `/compare/${slug}`,
      label: translate('alternative2', { name: name }),
    })),
  },
  {
    title: translate('legal'),
    links: [
      { href: '/terms', label: translate('termsOfService') },
      { href: '/privacy', label: translate('privacyPolicy2') },
      { href: '/dpa', label: translate('dataProcessingAgreement2') },
      { href: '/subprocessors', label: translate('subprocessors') },
      { href: '/imprint', label: translate('imprint') },
    ],
  },
]
