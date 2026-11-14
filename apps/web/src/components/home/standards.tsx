import { Container } from '@/components/section'
import { cn } from '@/lib/cn'
import { TONES } from '@/lib/tones'

const DOTS = [
  TONES.mint.dot,
  TONES.sky.dot,
  TONES.lilac.dot,
  TONES.peach.dot,
  TONES.rose.dot,
  TONES.lemon.dot,
]

// The formats and rules Helvetly speaks, each one implemented in the API.
const STANDARDS = [
  'Swiss QR bill (SIX)',
  'QR-IBAN · QRR · SCOR',
  'eCH-0217 VAT return',
  'Effective & net tax rate',
  'XRechnung UBL / CII',
  'Peppol BIS Billing',
  'KSeF FA(3)',
  'RO e-Factura',
  'OR 104 default interest',
  'nDSG & GDPR',
  'Passkeys & TOTP',
  'Simple e-signatures',
]

export function Standards() {
  return (
    <section aria-label="Standards Helvetly supports" className="py-10">
      <Container>
        <p data-reveal className="text-center text-body-sm text-muted-foreground">
          Speaks the formats your trustee, your clients and the ESTV expect
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
