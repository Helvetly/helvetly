import Link from 'next/link'

import type { Question } from '@/components/faq'
import { bytes, count, LIMITS, MAX_SELF_SERVICE_SEATS, plansWith, TRIAL } from '@/lib/plans'

const ai = LIMITS.ai_tokens_per_month.values
const actions = LIMITS.automation_actions_per_month.values
const millions = (n: number | null) => `${(n ?? 0) / 1_000_000} million`

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
    a: `With ${plansWith('corrections_vat')}, Helvetly prepares it: the figures per Ziffer, a PDF summary and the eCH-0217 file the ESTV ePortal imports. You or your trustee submit it in the ePortal, as the law expects.`,
  },
  {
    q: 'What does Heidi do with my data?',
    a: (
      <>
        Heidi is included in {plansWith('heidi', ' and ')}. Nothing leaves for an AI model until an
        owner or admin switches AI on for the workspace; until then Heidi answers only from built-in
        commands. Either way she reads only what you may see yourself, and changes nothing without
        your confirmation. The details are in the <Link href="/privacy">privacy policy</Link> and
        the <Link href="/subprocessors">list of subprocessors</Link>.
      </>
    ),
  },
  {
    q: 'Can I move my existing data in?',
    a: `Yes. Upload PDFs, images, spreadsheets, Word files or a ZIP, and the AI import turns them into clients, invoices, products or engagements, and with ${plansWith('expenses')} expenses, for you to check before they are saved.`,
  },
  {
    q: 'What happens if I stop paying?',
    a: 'Your workspace becomes read-only. Nothing is deleted, you can still read and download everything, and choosing a plan again unlocks it at once.',
  },
]

export const PRICING_FAQ: Question[] = [
  {
    q: 'How does the trial work?',
    a: `Try Business for ${TRIAL.days} days with up to ${TRIAL.members} team members and smaller shared allowances: ${TRIAL.invoices} invoice issues, ${TRIAL.expenses} expenses, ${TRIAL.signatures} signature requests, ${bytes(TRIAL.storageBytes)} storage, ${count(TRIAL.aiTokens)} AI tokens and ${TRIAL.automationActions} automation actions. A payment card is required. Trial allowances do not reset or multiply by team size. After conversion, every team member is billed at the full selected plan price.`,
  },
  {
    q: 'Are prices per person?',
    a: `Yes. Every team member (owners, admins, members, accountants and read-only members) is billed at the full price of the plan, and no extra seats are included. Invitations count once accepted, and changes are prorated. You can have up to ${MAX_SELF_SERVICE_SEATS} people in the app; ask us for more. Clients in the portal and people you send a document to sign are not team members and cost nothing.`,
  },
  {
    q: 'Is VAT included?',
    a: 'Yes. Prices are in CHF in Switzerland and Liechtenstein, EUR in the EU and USD everywhere else, with the same figures, and include the VAT or sales tax that applies, so the price you see is the price you pay. Your invoice shows the tax share; a business with a VAT number that owes the VAT itself pays the same amount, without VAT on the invoice.',
  },
  {
    q: 'How do the allowances work?',
    a: 'Clients, products and engagements are fixed caps for the workspace. The other allowances are per paid person, and add up into one pool the whole workspace shares; adding or changing a member does not start the pools again. Monthly pools start again at 00:00 UTC on the first of the month, and the first part-month is prorated. Storage is what you keep, history included, not a monthly amount. MB and GB are decimal: 1 GB = 1’000 MB.',
  },
  {
    q: 'What happens when I reach a limit?',
    a: 'Nothing is charged extra and nothing is deleted. Only the new action that needs the allowance stops, for example issuing one more invoice; your drafts and everything you already have stay, and so does the work you can do by hand. You can upgrade or wait for the next month.',
  },
  {
    q: 'What are AI tokens?',
    a: `Your workspace shares the AI tokens contributed by each paid person. Basic includes ${count(ai.basic ?? 0)} tokens for import into its available modules; Heidi and receipt import require ${plansWith('heidi')}. Pro includes ${millions(ai.pro)} and Business ${millions(ai.business)} tokens per paid person a month. Requests, responses and conversation context use tokens, so there is no fixed number of documents or conversations.`,
  },
  {
    q: 'What counts as an automation action?',
    a: `Pro includes ${count(actions.pro ?? 0)} and Business ${count(actions.business ?? 0)} actions per paid person a month. Automatically issuing an invoice and emailing it to one recipient uses two actions; each payment reminder uses one more. Empty checks and retries of the same action do not count again. Email, invoice and AI allowances also apply. When the allowance runs out, automations pause; manual work remains available.`,
  },
  {
    q: 'How does the Revolut payment link work?',
    a: 'It adds your revolut.me link and QR code to the invoice. Your client enters the displayed amount and reference. Bank synchronisation and automatic payment confirmation are not included.',
  },
  {
    q: 'Which plan do VAT returns and corrections need?',
    a: `VAT is calculated on invoices in every plan. Preparing VAT returns and their exports requires ${plansWith('corrections_vat')}. Credit notes, debit notes, corrections and cancelling issued invoices require ${plansWith('corrections_vat')} too; editing a draft remains available in Basic.`,
  },
  {
    q: 'What kind of signatures and e-invoices are these?',
    a: `Simple electronic signatures, with ${plansWith('templates_signatures')}; qualified signatures are not included. ${plansWith('einvoice_xml')} exports supported e-invoice XML files; Peppol, KSeF and RO network delivery is not included.`,
  },
  {
    q: 'Can I export my data?',
    a: `Export client, product and other business data, plus supported accounting formats, with ${plansWith('ledger_exports')}. Basic retains existing records and individual invoice PDFs. E-invoice XML requires ${plansWith('einvoice_xml')}.`,
  },
  {
    q: 'Can I change plans later?',
    a: 'Any time, from the workspace settings. A smaller plan deletes nothing: what you have stays readable, but new work must fit its allowances and features.',
  },
  {
    q: 'Do I need several plans for several companies?',
    a: 'Each company gets its own workspace with its own plan, and you switch between them with one account.',
  },
]
