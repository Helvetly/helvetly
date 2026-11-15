import { localizedAlternates } from '@helvetly/i18n'
import type { Metadata } from 'next'

import { HelpCenter } from '@/components/help-center'
import { PageHero } from '@/components/page-hero'
import { Container } from '@/components/section'
import { readCollection } from '@/lib/content'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = {
  alternates: localizedAlternates('/help'),

  title: translate('helpCenter'),
  description: translate('stepByStepHelpForHelvetlyClientsInvoicesAnd'),
}

export default function HelpPage() {
  const entries = readCollection('help').map(({ slug, title, description, category }) => ({
    slug,
    title,
    description,
    category,
  }))
  return (
    <main>
      <PageHero
        eyebrow={translate('helpCenter')}
        title={
          <>
            {translate('howCanWe')}
            <span className="accent">{translate('help')}</span>
          </>
        }
        lead={translate('stepByStepAnswersForEveryScreenInHelvetly', { length: entries.length })}
      />
      <section className="pb-24">
        <Container>
          <HelpCenter entries={entries} />
        </Container>
      </section>
    </main>
  )
}
