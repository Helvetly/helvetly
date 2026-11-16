import { defaultLocale, languageHref, localizedHref } from '@helvetly/i18n'

import { compareIn } from '@/lib/compare'
import { perLanguage } from '@/lib/i18n'

export const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL ?? 'http://localhost:8000'
export const SUPPORT_EMAIL = 'support@helvetly.com'

/** The site's links and their labels in one language, every page link in that language. */
export const siteIn = perLanguage((translate, language) => {
  // Sign-in is passwordless and makes the account on first use, so starting and signing in share a page.
  const SIGN_IN_URL = `${PLATFORM_URL}${language === defaultLocale ? '/login' : languageHref('/login', language)}`
  const localize = (links: { href: string; label: string }[]) =>
    links.map(({ href, label }) => ({ href: localizedHref(href, language), label }))

  const NAV = [
    { href: '/#features', label: translate('product') },
    { href: '/pricing', label: translate('pricing') },
    { href: '/security', label: translate('security') },
    { href: '/guides', label: translate('guides') },
    { href: '/help', label: translate('help2') },
  ]

  const FOOTER = [
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
        { href: '/faq', label: translate('questions') },
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
      links: compareIn(language).COMPETITORS.map(({ slug, name }) => ({
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
  return {
    SIGN_IN_URL,
    START_URL: SIGN_IN_URL,
    NAV: localize(NAV),
    FOOTER: FOOTER.map(({ title, links }) => ({ title, links: localize(links) })),
  }
})
