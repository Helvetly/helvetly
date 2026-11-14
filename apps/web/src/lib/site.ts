import { COMPETITORS } from '@/lib/compare'

export const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL ?? 'http://localhost:8000'
// Sign-in is passwordless and makes the account on first use, so starting and signing in share a page.
export const SIGN_IN_URL = `${PLATFORM_URL}/login`
export const START_URL = SIGN_IN_URL

export const NAV = [
  { href: '/#features', label: 'Product' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/compare', label: 'Compare' },
  { href: '/security', label: 'Security' },
  { href: '/guides', label: 'Guides' },
  { href: '/help', label: 'Help' },
]

export const FOOTER = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/#heidi', label: 'Heidi, the assistant' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/pricing#compare-plans', label: 'Compare plans' },
    ],
  },
  {
    title: 'Why Helvetly',
    links: [
      { href: '/security', label: 'Security and privacy' },
      { href: '/#faq', label: 'Questions' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/guides', label: 'Guides' },
      { href: '/guides/swiss-vat', label: 'Swiss VAT, explained' },
      { href: '/guides/qr-bill', label: 'The Swiss QR bill' },
      { href: '/guides/payment-reminders', label: 'Payment reminders' },
      { href: '/help', label: 'Help center' },
    ],
  },
  {
    title: 'Comparisons',
    links: COMPETITORS.map(({ slug, name }) => ({
      href: `/compare/${slug}`,
      label: `${name} alternative`,
    })),
  },
  {
    title: 'Legal',
    links: [
      { href: '/terms', label: 'Terms of service' },
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/dpa', label: 'Data processing agreement' },
      { href: '/subprocessors', label: 'Subprocessors' },
      { href: '/imprint', label: 'Imprint' },
    ],
  },
]
