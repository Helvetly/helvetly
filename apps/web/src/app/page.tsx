import { FaqSection } from '@/components/faq'
import { Features } from '@/components/home/features'
import { HeidiSection } from '@/components/home/heidi-section'
import { Hero } from '@/components/home/hero'
import { Standards } from '@/components/home/standards'
import { Steps } from '@/components/home/steps'
import { Trust } from '@/components/home/trust'
import { PricingCards } from '@/components/pricing-cards'
import { Container, SectionHeading } from '@/components/section'
import { GENERAL_FAQ } from '@/lib/faq'
import { YEARLY_DISCOUNT_PERCENT } from '@/lib/plans'

export default function HomePage() {
  return (
    <main>
      <Hero />
      <Standards />
      <Features />
      <HeidiSection />
      <Steps />
      <Trust />
      <section id="pricing" className="py-12 sm:py-16">
        <Container>
          <SectionHeading
            eyebrow="Pricing"
            title={
              <>
                Simple plans, <span className="accent">one price</span> per person
              </>
            }
            lead={`Each team member pays the plan’s price. Start invoicing with Basic, run the whole back office with Pro. Pay yearly and save ${YEARLY_DISCOUNT_PERCENT}%.`}
          />
          <div className="mt-12">
            <PricingCards />
          </div>
        </Container>
      </section>
      <FaqSection
        id="faq"
        eyebrow="Questions"
        title={
          <>
            Good to <span className="accent">know</span>
          </>
        }
        lead="What people ask before they move their books to Helvetly."
        card={{
          title: 'Heidi answers the rest',
          body: 'Inside Helvetly, press ⌘J on any page and ask how something works. She knows every screen.',
          href: '/security',
          link: 'How Heidi treats your data',
        }}
        items={GENERAL_FAQ}
      />
    </main>
  )
}
