import { HeidiOrb } from '@helvetly/ui/components/heidi-mark'
import { Languages, type LucideIcon, ShieldCheck, ThumbsUp } from 'lucide-react'

import { HeidiShowcase } from '@/components/home/heidi-showcase'
import { Ridge } from '@/components/ridge'
import { Container } from '@/components/section'
import { translate } from '@/lib/i18n'
import { plansWith } from '@/lib/plans'

// What circles the orb: the jobs Heidi does. Both orbits turn together and their chips sit between each
// other's, so no two ever overlap.
const INNER = [translate('overdueInvoices'), translate('hoursLeft'), translate('inputVAT')]
const OUTER = [translate('draftAReminder'), translate('logWork'), translate('importReceipts')]

const PROMISES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ThumbsUp,
    title: translate('nothingHappensWithoutAYes'),
    body: translate('heidiShowsExactlyWhatSheWillChangeInWords'),
  },
  {
    icon: ShieldCheck,
    title: translate('offUntilYouSwitchItOn'),
    body: translate('noAIModelSeesYourDataUntilAnOwner'),
  },
  {
    icon: Languages,
    title: translate('speaksYourLanguage'),
    body: translate('askInEnglishGermanFrenchItalianOrPolishShe'),
  },
]

function Orbit({ items, size, offset = 0 }: { items: string[]; size: string; offset?: number }) {
  return (
    <div
      aria-hidden
      className={`absolute top-1/2 left-1/2 ${size} orbit -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10`}
    >
      {items.map((item, i) => {
        const angle = (360 / items.length) * i + offset
        return (
          <span
            key={item}
            className="absolute top-1/2 left-1/2"
            style={{ transform: `rotate(${angle}deg) translateX(var(--r)) rotate(${-angle}deg)` }}
          >
            {/* Turns against the orbit, so the label always reads upright. */}
            <span
              className={`counter-spin inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 text-caption font-medium whitespace-nowrap text-white/85 backdrop-blur-md`}
            >
              <span className="size-1.5 rounded-full bg-linear-to-br from-heidi-from to-heidi-to" />
              {item}
            </span>
          </span>
        )
      })}
    </div>
  )
}

// Heidi's band: the page's night sky, in her violet, always dark whatever the theme.
export function HeidiSection() {
  return (
    <section id="heidi" className="relative mt-32 sm:mt-48">
      <Ridge edge="rise" />
      <div className="dark night relative overflow-hidden pt-6 pb-36 text-white sm:pb-52">
        <div aria-hidden className="dot-field absolute inset-0 mask-t-from-70% opacity-30" />
        <div
          aria-hidden
          className="beams beam absolute top-[-30%] left-1/2 size-[70rem] -translate-x-1/2"
        />
        {/* The sky starts flat where the dusk ends, so the two never show a seam. */}
        <div
          aria-hidden
          className="from-night-2 absolute inset-x-0 top-0 h-40 bg-linear-to-b to-transparent"
        />
        {/* A few stars, placed by hand so the sky is the same on every render. */}
        {[
          [8, 12],
          [18, 40],
          [27, 8],
          [72, 14],
          [84, 36],
          [91, 9],
          [12, 70],
          [88, 66],
          [64, 5],
          [36, 22],
        ].map(([x, y], i) => (
          <span
            key={`${x}-${y}`}
            aria-hidden
            className="twinkle absolute size-1 rounded-full bg-white/70"
            style={{ left: `${x}%`, top: `${y}%`, ['--d' as string]: `${i * 330}ms` }}
          />
        ))}

        <Container className="relative flex flex-col items-center text-center">
          <div className="grid w-full max-w-6xl items-center gap-6 pt-16 sm:pt-20 lg:grid-cols-[1.15fr_1fr] lg:gap-4">
            {/* The orb and its orbits: beside the heading on wide screens, above it on narrow ones. */}
            <div className="relative mx-auto h-40 w-full max-w-md sm:h-[22rem] lg:order-last lg:h-[26rem]">
              <div className="hidden sm:block">
                <Orbit
                  items={INNER}
                  size="size-[13rem] [--r:6.5rem] lg:size-[15rem] lg:[--r:7.5rem]"
                />
                <Orbit
                  items={OUTER}
                  size="size-[20rem] [--r:10rem] lg:size-[23rem] lg:[--r:11.5rem]"
                  offset={60}
                />
              </div>
              <HeidiOrb className="absolute top-1/2 left-1/2 size-24 -translate-x-1/2 -translate-y-1/2 sm:size-28" />
            </div>

            <div
              data-reveal
              className="flex flex-col items-center gap-5 lg:items-start lg:text-left"
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1 text-body-sm font-medium text-heidi-ink">
                <span aria-hidden className="size-1.5 rounded-full bg-heidi-to" />
                {translate('heidiYourAIAssistant')}
              </span>
              <h2 className="text-hero font-semibold text-balance">
                {translate('askYourBooks')}
                <span className="accent ink-gradient pr-2">{translate('anything')}</span>
              </h2>
              <p className="text-lead max-w-2xl text-balance text-white/70">
                {translate('pressJOnAnyPageHeidiKnowsWhatIs2')}
                {plansWith('heidi', 'conjunction')}.
              </p>
            </div>
          </div>

          <div
            data-reveal
            style={{ ['--d' as string]: '120ms' }}
            className="relative mt-14 w-full max-w-3xl"
          >
            <div
              aria-hidden
              className="absolute -inset-10 bg-[radial-gradient(closest-side,rgb(178_61_255/0.45),transparent)] blur-3xl"
            />
            <HeidiShowcase />
          </div>

          <div className="mt-14 grid w-full max-w-5xl gap-4 text-left md:grid-cols-3">
            {PROMISES.map(({ icon: Icon, title, body }, i) => (
              <div
                key={title}
                data-reveal
                style={{ ['--d' as string]: `${i * 100}ms` }}
                className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur"
              >
                <span className="inline-flex size-10 items-center justify-center rounded-xl bg-linear-to-br from-heidi-from to-heidi-to text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]">
                  <Icon aria-hidden className="size-5" />
                </span>
                <h3 className="mt-4 text-title-sm font-semibold">{title}</h3>
                <p className="mt-1.5 text-body text-white/65">{body}</p>
              </div>
            ))}
          </div>
        </Container>
      </div>
      <Ridge edge="fall" />
    </section>
  )
}
