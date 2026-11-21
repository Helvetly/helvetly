import type { Locale } from '@helvetly/i18n'

import { Container } from '@/components/section'
import { translatorFor } from '@/lib/i18n'

/** A plain definition of Helvetly in one liftable paragraph, for readers and answer engines alike. */
export function About({ lang }: { lang: Locale }) {
  const translate = translatorFor(lang)
  return (
    <section id="about" className="py-10 sm:py-14">
      <Container className="flex max-w-5xl flex-col gap-3 text-center">
        <h2 data-reveal className="text-title font-semibold">
          {translate('whatIsHelvetly')}
        </h2>
        <p data-reveal className="text-lead text-balance text-muted-foreground">
          {translate('whatIsHelvetlyAnswer')}
        </p>
      </Container>
    </section>
  )
}
