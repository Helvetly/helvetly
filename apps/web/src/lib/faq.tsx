import Link from 'next/link'

import type { Question } from '@/components/faq'
import { TRIAL_DAYS } from '@/lib/plans'

export const GENERAL_FAQ: Question[] = [
  {
    q: 'Who is Helvetly for?',
    a: 'Swiss companies and the people who run them: from a one-person GmbH to a team with a trustee, an assistant and several partners. Everyone works in the same workspace with their own role.',
  },
  {
    q: 'Does it create real Swiss QR bills?',
    a: 'Yes. Every invoice can carry the QR bill with a QR-IBAN and QRR reference or a normal IBAN with a creditor reference (SCOR), and reminders can carry one for the total due.',
  },
  {
    q: 'Can Helvetly file my VAT return?',
    a: 'Helvetly prepares it: the figures per Ziffer, a PDF summary and the eCH-0217 file the ESTV ePortal imports. You or your trustee submit it in the ePortal, as the law expects.',
  },
  {
    q: 'What does Heidi do with my data?',
    a: (
      <>
        Nothing leaves for an AI model until an owner or admin switches AI on for the workspace;
        until then Heidi answers only from built-in commands. Either way she reads only what you may
        see yourself, and changes nothing without your confirmation. The details are in the{' '}
        <Link href="/privacy">privacy policy</Link> and the{' '}
        <Link href="/subprocessors">list of subprocessors</Link>.
      </>
    ),
  },
  {
    q: 'Can I move my existing data in?',
    a: 'Yes. Upload PDFs, images, spreadsheets, Word files or a ZIP, and the AI import turns them into clients, invoices, expenses, products or engagements for you to check before they are saved.',
  },
  {
    q: 'What happens if I stop paying?',
    a: 'Your workspace becomes read-only. Nothing is deleted, you can still read and download everything, and choosing a plan again unlocks it at once.',
  },
]

export const PRICING_FAQ: Question[] = [
  {
    q: 'How does the trial work?',
    a: `Basic starts with a ${TRIAL_DAYS}-day trial, once per workspace. You add a card at the start and are charged only when the trial ends; cancel before then and you pay nothing.`,
  },
  {
    q: 'Are prices per user?',
    a: "Yes: each person in the workspace (owner, admins, members) is billed at the plan's price. Invitations count once accepted, and changes are prorated.",
  },
  {
    q: 'Is VAT included?',
    a: 'Yes. Prices are in CHF and include Swiss VAT, so the price you see is the price you pay. Your invoice shows the VAT share; businesses abroad with a VAT number are charged the same amount without Swiss VAT.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Any time, from the workspace settings. Moving to a smaller plan works as long as what you already have fits its limits.',
  },
  {
    q: 'What counts towards a limit?',
    a: 'Clients, products, engagements and storage count what exists now. Invoices, expenses, signature requests and AI tokens count what was created this calendar month and start again on the first.',
  },
  {
    q: 'Do I need several plans for several companies?',
    a: 'Each company gets its own workspace with its own plan, and you switch between them with one account.',
  },
]
