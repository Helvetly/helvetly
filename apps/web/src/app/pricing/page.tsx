import type { Metadata } from 'next'

import { FaqSection } from '@/components/faq'
import { PageHero } from '@/components/page-hero'
import { PlanTable } from '@/components/plan-table'
import { PricingCards } from '@/components/pricing-cards'
import { Container, SectionHeading } from '@/components/section'
import { PRICING_FAQ } from '@/lib/faq'
import { TRIAL_DAYS } from '@/lib/plans'
import { START_URL } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Basic, Pro and Business: prices per person in CHF, EUR or USD, tax included, every feature in every plan, 20% off when you pay yearly.',
}

export default function PricingPage() {
  return (
    <main>
      <PageHero
        eyebrow="Pricing"
        title={
          <>
            Simple prices, <span className="accent">every feature</span>
          </>
        }
        lead="You pay for each team member, and every plan has every feature. Pick the one that fits how much you invoice, and change it whenever your business does."
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
            lead="Monthly limits start again on the first of the month, in your workspace’s time zone."
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
          title: 'Every feature, from the first day',
          body: `Start a ${TRIAL_DAYS}-day trial with the whole product, then pick the plan that fits. You can change it any time from the workspace settings.`,
          href: START_URL,
          link: 'Start your free trial',
        }}
        items={PRICING_FAQ}
      />
    </main>
  )
}
