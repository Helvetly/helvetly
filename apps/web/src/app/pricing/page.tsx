import type { Metadata } from 'next'

import { FaqSection } from '@/components/faq'
import { PageHero } from '@/components/page-hero'
import { PlanTable } from '@/components/plan-table'
import { PricingCards } from '@/components/pricing-cards'
import { Container, SectionHeading } from '@/components/section'
import { PRICING_FAQ } from '@/lib/faq'
import { TRIAL } from '@/lib/plans'
import { START_URL } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Basic, Pro and Business compared: what each plan includes, the allowances each person adds and prices per person in CHF, EUR or USD, tax included.',
}

export default function PricingPage() {
  return (
    <main>
      <PageHero
        eyebrow="Pricing"
        title={
          <>
            Clear prices, <span className="accent">per person</span>
          </>
        }
        lead="Every team member is billed at the plan’s price. Basic gets you invoicing, Pro adds Heidi and the whole back office, Business adds the client portal and e-invoice XML."
      />
      <section className="pb-24">
        <Container>
          <PricingCards />
        </Container>
      </section>
      <section id="compare-plans" className="py-24">
        <Container>
          <SectionHeading
            eyebrow="Compare plans"
            title="What each plan includes"
            lead="See what is included and what is not before you choose. Monthly allowances start again at 00:00 UTC on the first of the month."
          />
          <div data-reveal className="mt-12">
            <PlanTable />
          </div>
        </Container>
      </section>
      <FaqSection
        eyebrow="Billing questions"
        title={
          <>
            Before you <span className="accent">choose</span>
          </>
        }
        lead="Trials, VAT, limits and changing plans, in short answers."
        card={{
          title: `Try Business for ${TRIAL.days} days`,
          body: `Up to ${TRIAL.members} people, with smaller trial allowances, then pick the plan that fits. You can change it any time from the workspace settings.`,
          href: START_URL,
          link: 'Start your free trial',
        }}
        items={PRICING_FAQ}
      />
    </main>
  )
}
