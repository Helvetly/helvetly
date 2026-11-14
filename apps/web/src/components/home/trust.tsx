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
import { type Tone, TONES } from '@/lib/tones'

const TRUST: { icon: LucideIcon; tone: Tone; title: string; body: string }[] = [
  {
    icon: Fingerprint,
    tone: 'lilac',
    title: 'No passwords to steal',
    body: 'Sign in with a passkey, Google or an emailed code, and add two-factor authentication with recovery codes.',
  },
  {
    icon: Link2,
    tone: 'mint',
    title: 'A tamper-evident ledger',
    body: 'Every financial change is written to an append-only, hash-chained audit log that refuses edits.',
  },
  {
    icon: Lock,
    tone: 'sky',
    title: 'Closed months stay closed',
    body: 'Close a period and nobody can issue, pay or void anything in it by accident.',
  },
  {
    icon: ArchiveRestore,
    tone: 'peach',
    title: 'Your data, yours to take',
    body: 'An owner can download the whole workspace as a ZIP, files included, whenever they like.',
  },
  {
    icon: EyeOff,
    tone: 'rose',
    title: 'No trackers, no ads',
    body: 'The platform runs without analytics or advertising scripts. Fonts are served by us, not Google.',
  },
  {
    icon: ShieldCheck,
    tone: 'lemon',
    title: 'Built for nDSG and GDPR',
    body: 'A data processing agreement, a public list of subprocessors and AI that stays off until you consent.',
  },
]

export function Trust() {
  return (
    <section className="relative py-14 sm:py-20">
      <div aria-hidden className="wash absolute inset-0 -z-10 mask-y-from-75% mask-y-to-100%" />
      <Container>
        <SectionHeading
          eyebrow="Security and privacy"
          tone="lilac"
          title={
            <>
              Swiss about the <span className="accent">details</span>
            </>
          }
          lead="Your books are the record of your company. Helvetly treats them that way."
        />
        <TrustGrid className="mt-16" />
        <p data-reveal className="mt-8 text-center text-body text-muted-foreground">
          Read more about{' '}
          <Link
            href="/security"
            className="text-link underline underline-offset-4 hover:no-underline"
          >
            how we protect your data
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
