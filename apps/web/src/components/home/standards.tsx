import type { Locale } from '@helvetly/i18n'

import { Container } from '@/components/section'
import { cn } from '@/lib/cn'
import { translatorFor } from '@/lib/i18n'
import { TONES } from '@/lib/tones'

const DOTS = [
  TONES.mint.dot,
  TONES.sky.dot,
  TONES.lilac.dot,
  TONES.peach.dot,
  TONES.rose.dot,
  TONES.lemon.dot,
]

export function Standards({ lang }: { lang: Locale }) {
  const translate = translatorFor(lang)
  // The formats and rules Helvetly speaks, each one implemented in the API.
  const STANDARDS = [
    translate('swissQRBillSIX'),
    translate('qrIBANQRRSCOR'),
    translate('ech0217VATReturn'),
    translate('effectiveNetTaxRate'),
    translate('xrechnungUBLCII'),
    translate('peppolBISBilling'),
    translate('ksefFA3'),
    translate('roEFactura'),
    translate('or104DefaultInterest'),
    translate('ndsgGDPR'),
    translate('passkeysTOTP'),
    translate('simpleESignatures'),
  ]
  return (
    <section aria-label={translate('standardsHelvetlySupports')} className="py-10">
      <Container>
        <p data-reveal className="text-center text-body-sm text-muted-foreground">
          {translate('speaksTheFormatsYourTrusteeYourClientsAndThe')}
        </p>
      </Container>
      {/* WCAG 2.2.2: the moving list stops while the pointer rests on it. */}
      <div className="mt-6 overflow-hidden mask-x-from-85% mask-x-to-100%">
        <ul className="animate-marquee flex w-max gap-3">
          {[...STANDARDS, ...STANDARDS].map((item, i) => (
            <li
              key={`${i < STANDARDS.length ? 'a' : 'b'}-${item}`}
              aria-hidden={i >= STANDARDS.length}
              className="border-site-line bg-site/80 inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-body font-medium whitespace-nowrap text-foreground/80"
            >
              <span aria-hidden className={cn('size-2 rounded-full', DOTS[i % DOTS.length])} />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
