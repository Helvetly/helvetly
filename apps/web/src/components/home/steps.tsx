import { FileUp, Landmark, Send } from 'lucide-react'

import { Container, SectionHeading } from '@/components/section'
import { cn } from '@/lib/cn'
import { type Tone, TONES } from '@/lib/tones'

const STEPS: { icon: typeof FileUp; tone: Tone; title: string; body: string }[] = [
  {
    icon: FileUp,
    tone: 'sky',
    title: 'Bring what you have',
    body: 'Upload old invoices, client lists, receipts or a spreadsheet. The AI import turns them into records you check before anything is saved.',
  },
  {
    icon: Send,
    tone: 'mint',
    title: 'Invoice and get paid',
    body: 'Issue an invoice with the QR bill, email it from Helvetly, and let reminders and instalments follow up on their own.',
  },
  {
    icon: Landmark,
    tone: 'lilac',
    title: 'Close the quarter',
    body: 'Close the month so nothing changes behind your back, then export the VAT return for the ePortal and the files for your trustee.',
  },
]

export function Steps() {
  return (
    <section className="py-4">
      <Container>
        <SectionHeading
          eyebrow="How it works"
          tone="sky"
          title={
            <>
              Set up in an afternoon, <span className="accent">calm</span> every month after
            </>
          }
        />
        <div className="relative mt-12">
          {/* The path the three steps share, drawing itself from sky through mint to lilac. */}
          <div
            aria-hidden
            data-reveal
            className="absolute top-[52px] left-[16%] hidden h-0.5 w-[68%] md:block"
          >
            <div className="grow-x from-sky-solid via-mint-solid to-lilac-solid h-full origin-left rounded-full bg-linear-to-r opacity-60" />
          </div>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, tone, title, body }, i) => (
              <li
                key={title}
                data-reveal
                style={{ ['--d' as string]: `${i * 140}ms` }}
                className={cn(
                  'relative flex flex-col items-center rounded-3xl border p-7 pt-8 text-center',
                  TONES[tone].tile,
                  TONES[tone].border,
                )}
              >
                <span
                  className={cn(
                    'relative inline-flex size-14 items-center justify-center rounded-2xl text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]',
                    TONES[tone].solid,
                  )}
                >
                  <Icon aria-hidden className="size-6" />
                  <span className="bg-site ring-site-line absolute -top-2 -right-2 inline-flex size-6 items-center justify-center rounded-full text-caption font-semibold text-foreground ring-1">
                    {i + 1}
                  </span>
                </span>
                <h3 className="mt-5 text-title font-semibold tracking-tight">{title}</h3>
                <p className="mt-2 max-w-xs text-body text-pretty text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  )
}
