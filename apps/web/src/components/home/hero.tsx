import { HeidiMark } from '@helvetly/ui/components/heidi-mark'
import { ArrowRight, Check, CircleCheck } from 'lucide-react'
import Link from 'next/link'

import { Cta } from '@/components/cta'
import { ProductWindow } from '@/components/home/product-window'
import { QrGlyph } from '@/components/home/qr-glyph'
import { Container } from '@/components/section'
import { translate } from '@/lib/i18n'
import { TRIAL_DAYS } from '@/lib/plans'
import { START_URL } from '@/lib/site'

export function Hero() {
  return (
    <section className="relative overflow-x-clip pt-32 sm:pt-40">
      {/* Backdrop: pastel blooms drifting behind a hairline grid, and a teal-to-violet horizon
          glowing under the product. */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="aurora animate-drift bg-mint top-[-12%] left-[-4%] h-[520px] w-[620px]" />
        <div className="aurora animate-drift-slow bg-lilac top-[-6%] right-[-6%] h-[500px] w-[600px]" />
        <div className="aurora animate-drift bg-sky top-[22%] left-[30%] h-[360px] w-[520px]" />
        <div className="aurora animate-drift-slow bg-peach top-[30%] right-[10%] h-[300px] w-[380px]" />
        <div className="absolute inset-x-0 top-[52%] h-[70%] bg-[radial-gradient(50%_55%_at_50%_45%,var(--mint-solid)_0%,var(--lilac-solid)_45%,transparent_75%)] opacity-25 blur-3xl dark:opacity-30" />
      </div>
      <div aria-hidden className="dot-field absolute inset-0 -z-10" />

      <Container className="flex flex-col items-center text-center">
        <Link
          href="#heidi"

          className="rise group ring-gradient bg-site/80 inline-flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-body-sm text-muted-foreground backdrop-blur transition-colors hover:border-foreground/15 hover:text-foreground"
        >
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-heidi-soft px-2 py-0.5 font-medium whitespace-nowrap text-heidi-ink">
            <HeidiMark className="size-3.5" animated />
            {translate('new')}
          </span>
          {translate('meetHeidiTheAssistantWhoKnowsYourBooks')}
          <ArrowRight aria-hidden className="size-3.5 shrink-0" />
        </Link>

        <h1
          style={{ ['--d' as string]: '80ms' }}
          className="rise text-hero mt-7 max-w-4xl font-semibold text-balance"
        >
          {translate('yourSwissBackOffice')}
          <span className="accent ink-gradient pr-1">{translate('beautifully')}</span>
          {translate('inOrder')}
        </h1>

        <p
          style={{ ['--d' as string]: '160ms' }}
          className="rise text-lead mt-6 max-w-3xl text-balance text-muted-foreground"
        >
          {translate('qrInvoicesRemindersThatSendThemselvesExpensesContractsAnd')}
        </p>

        <div
          style={{ ['--d' as string]: '240ms' }}
          className="rise mt-9 flex w-full max-w-xs flex-col items-center gap-3 sm:w-auto sm:max-w-none sm:flex-row"
        >
          <Cta href={START_URL} className="w-full sm:w-auto">
            {translate('startYour')}
            {TRIAL_DAYS}
            {translate('dayTrial')}
          </Cta>
          <Cta href="/pricing" variant="outline" className="w-full sm:w-auto">
            {translate('seePricing')}
          </Cta>
        </div>

        <ul
          style={{ ['--d' as string]: '320ms' }}
          className="rise mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-body-sm text-muted-foreground"
        >
          {(
            [
              [translate('swissQrBillBuiltIn'), 'bg-mint text-mint-ink'],
              [translate('passwordlessSignIn'), 'bg-lilac text-lilac-ink'],
              [translate('exportEverythingAnyTime'), 'bg-peach text-peach-ink'],
            ] as const
          ).map(([item, tone]) => (
            <li key={item} className="inline-flex items-center gap-2">
              <span
                className={`inline-flex size-4.5 items-center justify-center rounded-full ${tone}`}
              >
                <Check aria-hidden className="size-3" />
              </span>
              {item}
            </li>
          ))}
        </ul>
      </Container>

      {/* The product, with the moments it is made for floating around it. */}
      <Container className="relative mt-16 max-w-6xl pb-16 sm:mt-20">
        <div style={{ ['--d' as string]: '400ms' }} className="rise">
          <div className="tilt-in origin-top">
            <ProductWindow />
          </div>
        </div>

        <div className="loop-toast border-site-line pointer-events-none absolute -bottom-2 left-2 z-10 hidden w-72 items-center gap-3 rounded-2xl border bg-card/90 p-3 text-left shadow-[0_24px_60px_-24px_rgb(85_39_201/0.45)] backdrop-blur sm:flex lg:-left-6">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-success-surface text-success">
            <CircleCheck className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-body-sm font-semibold">{translate('paymentReceived')}</span>
            <span className="block truncate text-caption text-muted-foreground">
              {translate('alpenglHnGmbHPaid20260418CHF4860')}
            </span>
          </span>
        </div>

        {/* The floating cards arrive once the window has, so they never hang over an empty frame. */}
        <div
          style={{ ['--d' as string]: '1100ms' }}
          className="rise absolute top-24 -right-4 z-10 hidden w-44 xl:block"
        >
          <div className="animate-float border-mint-solid/25 rounded-2xl border bg-card/90 p-3 text-left shadow-[0_24px_60px_-24px_rgb(85_39_201/0.45)] backdrop-blur">
            <p className="bg-mint text-mint-ink inline-flex rounded-full px-2 py-0.5 text-caption font-medium">
              {translate('paymentPart2')}
            </p>
            <QrGlyph className="mt-2 w-full text-foreground" />
            <p className="mt-2 text-caption text-muted-foreground">
              {translate('qrIBANQRRReference')}
            </p>
          </div>
        </div>

        <div
          style={{ ['--d' as string]: '1350ms' }}
          className="rise absolute -right-6 bottom-16 z-10 hidden w-72 lg:block"
        >
          <div
            className="animate-float ring-gradient rounded-2xl bg-card/90 p-3 text-left shadow-[0_24px_60px_-24px_rgb(85_39_201/0.45)] backdrop-blur"
            style={{ animationDelay: '-3s' }}
          >
            <div className="flex items-start gap-2.5">
              <HeidiMark className="size-7" animated />
              <div className="text-body-sm">
                <p className="font-semibold">{translate('heidi')}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {translate('rheinConsultingIs12DaysOverdueOnCHF9')}
                </p>
                <div className="mt-2.5 flex gap-1.5">
                  <span className="rounded-full bg-linear-to-r from-heidi-from to-heidi-via px-2.5 py-1 text-caption font-medium text-white">
                    {translate('sendReminder')}
                  </span>
                  <span className="border-site-line rounded-full border px-2.5 py-1 text-caption">
                    {translate('later')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
