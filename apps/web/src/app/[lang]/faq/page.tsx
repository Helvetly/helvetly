import type { Metadata } from 'next'

import { FaqItem, FaqList } from '@/components/faq'
import { OpenQuestion } from '@/components/open-question'
import { PageHero } from '@/components/page-hero'
import { Container } from '@/components/section'
import { faqIn, TOPICS } from '@/lib/faq'
import { languageOf, translatorFor } from '@/lib/i18n'
import { pageMetadata } from '@/lib/metadata'
import { textOf } from '@/lib/text-of'

type Props = { params: Promise<{ lang?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  return pageMetadata(
    lang,
    '/faq',
    translate('questionsAndAnswers'),
    translate('metaFaqDescription'),
  )
}

export default async function FaqPage({ params }: Props) {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  const questions = faqIn(lang)
  const groups = Object.entries(TOPICS).map(([topic, heading]) => ({
    topic,
    title: translate(heading),
    items: questions.filter((item) => item.topic === topic),
  }))
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: textOf(item.a) },
    })),
  }
  return (
    <main>
      <script
        type="application/ld+json"
        // JSON.stringify output is safe in a script once "<" cannot close it.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replaceAll('<', '\\u003c'),
        }}
      />
      <OpenQuestion />
      <PageHero
        eyebrow={translate('questions')}
        title={translate('questionsAndAnswers')}
        lead={translate('faqPageLead')}
      >
        <nav aria-label={translate('topics')} className="mt-8 flex flex-wrap justify-center gap-2">
          {groups.map((group) => (
            <a
              key={group.topic}
              href={`#${group.topic}`}
              className="border-site-line rounded-full border bg-card/60 px-3.5 py-1.5 text-body-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              {group.title}
            </a>
          ))}
        </nav>
      </PageHero>
      <Container className="grid max-w-3xl gap-12 pb-20">
        {groups.map((group) => (
          <section key={group.topic} id={group.topic} className="scroll-mt-28">
            <h2 className="mb-4 text-title font-semibold tracking-tight">{group.title}</h2>
            <FaqList>
              {group.items.map((item, i) => (
                <FaqItem key={item.id} id={item.id} item={item} index={i} />
              ))}
            </FaqList>
          </section>
        ))}
      </Container>
    </main>
  )
}
