import type { Metadata } from 'next'

import { HelpCenter } from '@/components/help-center'
import { PageHero } from '@/components/page-hero'
import { Container } from '@/components/section'
import { readCollection } from '@/lib/content'
import { languageOf, translatorFor } from '@/lib/i18n'
import { pageMetadata } from '@/lib/metadata'

type Props = { params: Promise<{ lang?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  return pageMetadata(lang, '/help', translate('helpCenter'), translate('metaHelpDescription'))
}

export default async function HelpPage({ params }: Props) {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  const entries = readCollection('help', lang).map(({ slug, title, description, category }) => ({
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
