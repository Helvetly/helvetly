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
import { type Tone, TONES } from '@/lib/tones'

export const metadata: Metadata = {
  title: 'Security and privacy',
  description:
    'How Helvetly protects your company’s records: passwordless sign-in, a hash-chained audit log, closed periods, full export and AI that waits for consent.',
}

// Each point describes what the code does today; see the contracts in docs/ before changing one.
const SECTIONS: { title: string; icon: LucideIcon; tone: Tone; points: string[] }[] = [
  {
    title: 'Signing in',
    icon: Fingerprint,
    tone: 'lilac',
    points: [
      'No passwords: passkeys, Google or a six-digit code sent by email.',
      'Optional two-factor authentication with an authenticator app; recovery codes are stored hashed and work once.',
      'Every sign-in is its own session, which you can see and end from your account.',
      'The session cookie holds a random token; we keep only its SHA-256 hash.',
      'Changes need a per-session CSRF token, and sign-in attempts are rate-limited.',
    ],
  },
  {
    title: 'Your records',
    icon: ScrollText,
    tone: 'mint',
    points: [
      'Workspaces are isolated: every query is scoped to the workspace and the person’s role.',
      'Financial changes are written to an append-only, hash-chained audit log in the same transaction; the database refuses edits to it.',
      'Closed months cannot receive new invoices, payments, refunds or voids.',
      'Invoice numbers are gapless per series and year, and never reused.',
      'Deleting your account keeps your company’s financial history, as Swiss law requires.',
    ],
  },
  {
    title: 'Files',
    icon: FolderLock,
    tone: 'sky',
    points: [
      'Every upload is checked by the SHA-256 of its actual bytes, so the same file is never stored twice by accident.',
      'Downloads go through short-lived signed links, valid for five minutes.',
      'Signed documents keep a frozen original and a tamper-evident trail of every signing step.',
    ],
  },
  {
    title: 'AI',
    icon: Sparkles,
    tone: 'rose',
    points: [
      'Nothing is sent to an AI model until an owner or admin consents for the workspace; every consent is recorded. Until then Heidi answers only from built-in commands.',
      'Heidi reads only what the person asking may read, and changes nothing without their confirmation.',
      'Workspace content is passed to the model as data, not as instructions.',
      'Each plan has a monthly allowance of AI tokens, enforced on our servers.',
    ],
  },
  {
    title: 'Privacy',
    icon: ShieldCheck,
    tone: 'lemon',
    points: [
      'Built for the Swiss nDSG and the EU GDPR, with a data processing agreement for every customer.',
      'No analytics, advertising or tracking scripts in the platform.',
      'An owner can export the whole workspace as a ZIP, and anyone can export their own account data.',
      'Secrets such as two-factor keys and e-invoicing credentials are encrypted with AES-GCM.',
    ],
  },
]

export default function SecurityPage() {
  return (
    <main>
      <PageHero
        eyebrow="Security and privacy"
        title={
          <>
            Your books are the record of your company.{' '}
            <span className="accent">We treat them that way.</span>
          </>
        }
        lead="What Helvetly does to keep your financial records correct, private and yours."
      />
      <section className="pb-16">
        <Container>
          <TrustGrid />
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
            The legal side is in the{' '}
            <Link
              href="/privacy"
              className="text-link underline underline-offset-4 hover:no-underline"
            >
              privacy policy
            </Link>
            , the{' '}
            <Link href="/dpa" className="text-link underline underline-offset-4 hover:no-underline">
              data processing agreement
            </Link>{' '}
            and the{' '}
            <Link
              href="/subprocessors"
              className="text-link underline underline-offset-4 hover:no-underline"
            >
              list of subprocessors
            </Link>
            .
          </p>
        </Container>
      </section>
    </main>
  )
}
