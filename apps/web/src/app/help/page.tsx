import type { Metadata } from 'next'

import { HelpCenter } from '@/components/help-center'
import { PageHero } from '@/components/page-hero'
import { Container } from '@/components/section'
import { readCollection } from '@/lib/content'

export const metadata: Metadata = {
  title: 'Help center',
  description:
    'Step-by-step help for Helvetly: clients, invoices and QR bills, reminders, expenses, documents and signatures, VAT, your team and your account.',
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
        eyebrow="Help center"
        title={
          <>
            How can we <span className="accent">help?</span>
          </>
        }
        lead={`${entries.length} step-by-step answers for every screen in Helvetly.`}
      />
      <section className="pb-24">
        <Container>
          <HelpCenter entries={entries} />
        </Container>
      </section>
    </main>
  )
}
