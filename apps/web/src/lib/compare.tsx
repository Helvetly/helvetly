import { formatPrice } from '@helvetly/ui/lib/price'
import type { ReactNode } from 'react'

import { PLANS, priceOf } from '@/lib/plans'
import type { Tone } from '@/lib/tones'

// Side-by-side comparisons with other Swiss business software. What each competitor offers comes from its
// own public website on the date in `checked`. Comparative advertising must be accurate and verifiable
// (UWG art. 3 para. 1 lit. e): re-check a competitor's rows against its site before changing them.
// Re-check in a browser before each release: KLARA's prices (its pages disagree), KLARA's reminders and
// roles (help pages refused automated reads) and bexio's help-centre claims.

/** true: offered; false: not offered; null: not found on their site; text: how it is offered. */
export type Cell = string | boolean | null

export type RowKey =
  | 'madeFor'
  | 'price'
  | 'pricingModel'
  | 'teamRoles'
  | 'qrBill'
  | 'documentTypes'
  | 'invoiceLanguages'
  | 'reminders'
  | 'depositPartial'
  | 'instalments'
  | 'einvoices'
  | 'vatReturn'
  | 'expenses'
  | 'signatures'
  | 'contractTemplates'
  | 'clientPortal'
  | 'retainers'
  | 'auditLog'
  | 'assistant'
  | 'aiImport'
  | 'signIn'
  | 'dataExport'
  | 'notifications'
  | 'apps'

export const ROW_GROUPS: { group: string; rows: { key: RowKey; label: string }[] }[] = [
  {
    group: 'Who it is for',
    rows: [
      { key: 'madeFor', label: 'Made for' },
      { key: 'price', label: 'Price' },
      { key: 'pricingModel', label: 'Pricing model' },
      { key: 'teamRoles', label: 'Team and roles' },
    ],
  },
  {
    group: 'Getting paid',
    rows: [
      { key: 'qrBill', label: 'Swiss QR bill' },
      { key: 'documentTypes', label: 'Document types' },
      { key: 'invoiceLanguages', label: 'Invoice languages' },
      { key: 'reminders', label: 'Automatic reminders' },
      { key: 'depositPartial', label: 'Deposit and partial invoices' },
      { key: 'instalments', label: 'Instalment schedules with a QR bill each' },
      { key: 'einvoices', label: 'E-invoices' },
    ],
  },
  {
    group: 'Back office',
    rows: [
      { key: 'vatReturn', label: 'VAT return' },
      { key: 'expenses', label: 'Expenses with receipts' },
      { key: 'signatures', label: 'Electronic signatures' },
      { key: 'contractTemplates', label: 'Contract templates filled with client data' },
      { key: 'clientPortal', label: 'Client portal' },
      { key: 'retainers', label: 'Retainers with hour tracking' },
      { key: 'auditLog', label: 'Closed periods and audit log' },
    ],
  },
  {
    group: 'AI',
    rows: [
      { key: 'assistant', label: 'Assistant over your own records' },
      { key: 'aiImport', label: 'Import from your files with AI' },
    ],
  },
  {
    group: 'Security, data and apps',
    rows: [
      { key: 'signIn', label: 'Sign-in' },
      { key: 'dataExport', label: 'Export of all your data' },
      { key: 'notifications', label: 'Notifications per person' },
      { key: 'apps', label: 'Apps' },
    ],
  },
]

/** Helvetly's side of every comparison. */
export const OURS: Record<RowKey, Cell> = {
  madeFor: 'Swiss companies of any size, alone or as a team',
  price: `From ${formatPrice(priceOf(PLANS[0]!, 'month'))} per person / month, or ${formatPrice(priceOf(PLANS[0]!, 'year'))} per person / year, incl. VAT`,
  pricingModel: 'Per person, every feature in every plan',
  teamRoles: 'Owner, admins and members, any number of people',
  documentTypes:
    'Invoice, partial, prepayment, credit note, debit note, corrected, proforma and self-billed',
  contractTemplates: true,
  assistant: 'Heidi, built in: answers from your records and acts only after you confirm',
  aiImport: 'PDFs, images, CSV, Excel, Word and ZIP files, reviewed before anything is saved',
  signIn: 'Passkeys, emailed codes or Google, with TOTP two-factor',
  dataExport: 'The whole workspace as one ZIP, any time',
  notifications: 'Each person chooses, in the app and by email',
  qrBill: true,
  invoiceLanguages: 'German, French, Italian, English',
  reminders: 'Up to 10 steps with fees and OR 104 interest',
  depositPartial: true,
  instalments: true,
  einvoices: 'XRechnung, Peppol BIS, KSeF and e-Factura files',
  expenses: true,
  vatReturn:
    'Yes, with an ESTV export: effective and net tax rate, as the XML file the ePortal imports',
  signatures: true,
  clientPortal: true,
  retainers: true,
  auditLog: 'Closed months and a tamper-evident, hash-chained log',
  apps: 'Web app for every device',
}

export type Competitor = {
  slug: string
  name: string
  url: string
  /** Their icon, taken from their own website, under `public/brands`. */
  logo: string
  /** The card colour on the comparisons page. */
  tone: Tone
  /** One line on what they are, for the comparisons page. */
  summary: string
  /** The day their public site was last read for this page. */
  checked: string
  title: ReactNode
  lead: string
  /** Completes "Helvetly is the better fit when you…". */
  oursIf: string[]
  /** Completes "<name> may suit you better if you…". */
  theirsIf: string[]
  rows: Record<RowKey, Cell>
}

export const COMPETITORS: Competitor[] = [
  {
    slug: 'magic-heidi',
    name: 'Magic Heidi',
    url: 'https://magicheidi.ch',
    logo: '/brands/magic-heidi.png',
    tone: 'rose',
    summary: 'A simple invoicing and bookkeeping app for the Swiss self-employed.',
    checked: '11 November 2026',
    title: (
      <>
        Grown past the <span className="accent">Milchbüechli?</span>
      </>
    ),
    lead: 'Magic Heidi is a fine app for the self-employed keeping simple books. Helvetly is built for companies that invoice across borders, sign contracts, work in a team and want an assistant who knows the numbers.',
    oursIf: [
      'work as a team, with a trustee or with partners',
      'need e-invoices for Germany, Poland, Romania or Peppol BIS',
      'send contracts for signature and share documents with clients',
      'bill retainers and need to see the hours left',
      'want an assistant who answers from your books and does the busywork',
    ],
    theirsIf: [
      'send only a few invoices a year and want a free plan',
      'need native phone and desktop apps',
      'want your bank feed matched to invoices automatically',
      'sell through Shopify, Amazon or Etsy',
    ],
    rows: {
      madeFor: 'Swiss self-employed people and sole proprietorships',
      price: 'Free for 3 invoices and 3 receipts; Pro CHF 39 / month or CHF 299 / year, incl. VAT',
      pricingModel: 'A free plan, then one Pro plan',
      teamRoles: 'Team and fiduciary access',
      documentTypes:
        'Invoice, deposit and partial, credit note, cancellation with a corrected invoice',
      contractTemplates: null,
      assistant: 'Connects your own Claude or ChatGPT',
      aiImport: 'Excel, CSV or PDF, with AI column mapping',
      signIn: 'Google, Apple or an emailed code, with optional two-factor',
      dataExport: 'Everything as a ZIP, any time',
      notifications: null,
      qrBill: true,
      invoiceLanguages: 'German, French, Italian, English',
      reminders: true,
      depositPartial: true,
      instalments: false,
      einvoices: false,
      expenses: true,
      vatReturn: 'Yes, with an ESTV export',
      signatures: false,
      clientPortal: false,
      retainers: false,
      auditLog: false,
      apps: 'Native apps for iPhone, Android, Mac and Windows, and a web app',
    },
  },
  {
    slug: 'bexio',
    name: 'bexio',
    url: 'https://www.bexio.com',
    logo: '/brands/bexio.svg',
    tone: 'sky',
    summary: 'A broad Swiss business suite with accounting, payroll and an app marketplace.',
    checked: '11 November 2026',
    title: (
      <>
        Built to get you paid, <span className="accent">not</span> to run an ERP
      </>
    ),
    lead: 'bexio is a broad Swiss business suite with accounting, payroll and a large marketplace. Helvetly focuses on the back office around getting paid: QR invoices, reminders, instalments, signatures, a client portal and an assistant who knows your numbers, at one simple price per person.',
    oursIf: [
      'need e-invoices for Germany, Poland, Romania or Peppol BIS',
      'send contracts for signature and share documents in a client portal',
      'bill retainers and need to see the hours left',
      'want instalment plans with a QR bill for each part',
      'want every feature in every plan, with no add-on modules',
    ],
    theirsIf: [
      'need full bookkeeping and annual financial statements in the same tool',
      'run Swissdec-certified payroll for employees',
      'need stock management alongside invoicing',
      'work with a fiduciary who already uses bexio',
    ],
    rows: {
      madeFor: 'Swiss small businesses, startups, the self-employed and their fiduciaries',
      price:
        'Basic CHF 35 / month billed yearly (CHF 45 monthly), 1 user; Ultimate CHF 119 / month billed yearly (CHF 129 monthly); excl. VAT',
      pricingModel:
        'Four tiers by features and included users, plus add-ons such as payroll and bexio Pay',
      teamRoles: 'Users per plan with permissions; free fiduciary access',
      documentTypes: 'Invoice, credit note and partial invoices from an order',
      contractTemplates: null,
      assistant: null,
      aiImport: 'AI reads receipts and QR invoices (Advanced and up)',
      signIn: 'Password and an emailed code, optional authenticator app',
      dataExport: 'Per module, as Excel or PDF',
      notifications: null,
      qrBill: true,
      invoiceLanguages: 'Multilingual templates, language per document',
      reminders: 'Automatic, with configurable levels',
      depositPartial: true,
      instalments: null,
      einvoices: 'eBill through an integration',
      expenses: 'From the Advanced plan',
      vatReturn: 'Effective and net tax rate; figures transferred to the ESTV by hand',
      signatures: null,
      clientPortal: null,
      retainers: null,
      auditLog: 'Fiscal years can be locked',
      apps: 'Web app; bexio Go for iOS and Android',
    },
  },
  {
    slug: 'klara',
    name: 'KLARA',
    url: 'https://www.klara.ch',
    logo: '/brands/klara.png',
    tone: 'peach',
    summary: 'A modular SME suite with accounting, payroll, POS and an online shop.',
    checked: '11 November 2026',
    title: (
      <>
        Everything to get paid, <span className="accent">without</span> the modules
      </>
    ),
    lead: 'KLARA bundles accounting, payroll, a till and an online shop as packages and modules. Helvetly keeps invoicing, reminders, expenses, contracts and the VAT return in one flat plan, with e-invoices for Europe and Heidi at your side.',
    oursIf: [
      'need e-invoices for Germany, Poland, Romania or Peppol BIS',
      'send contracts for signature and share documents in a client portal',
      'bill retainers and need to see the hours left',
      'want instalment plans with a QR bill for each part',
      'prefer one simple price per person to packages and per-use add-ons',
    ],
    theirsIf: [
      'want accounting, payroll and invoicing from one Swiss vendor',
      'run a shop or venue and need a till with card terminals',
      'send invoices by eBill, ePost or Swiss Post print',
      'want an online shop and booking from the same vendor',
    ],
    rows: {
      madeFor: 'Swiss SMEs: accounting, CRM, orders, payroll and POS in one cloud suite',
      price:
        'Business Basic CHF 69 / month, or CHF 55 / month on a yearly plan; Business Premium CHF 159, or CHF 127 yearly; excl. VAT',
      pricingModel: 'Packages plus paid modules, some charged per use',
      teamRoles: 'Roles for admins, trustees, payroll, accounting and more',
      documentTypes: 'Invoice, credit note, collective and recurring invoices',
      contractTemplates: null,
      assistant: 'Connects an outside ChatGPT or Claude',
      aiImport: 'AI receipt scanning',
      signIn: 'Password, optional authenticator app',
      dataExport: 'Per area, such as customers or reports',
      notifications: null,
      qrBill: true,
      invoiceLanguages: null,
      reminders: 'Three levels, sent after confirmation',
      depositPartial: true,
      instalments: null,
      einvoices: 'eBill and ePost',
      expenses: true,
      vatReturn: 'Effective and net tax rate, with an XML file for the ESTV portal',
      signatures: null,
      clientPortal: null,
      retainers: null,
      auditLog: null,
      apps: 'Web app; myKLARA for iOS and Android; a POS app',
    },
  },
  {
    slug: 'banana',
    name: 'Banana',
    url: 'https://www.banana.ch',
    logo: '/brands/banana.png',
    tone: 'lemon',
    summary: 'Low-cost desktop accounting software for people who keep their own books.',
    checked: '11 November 2026',
    title: (
      <>
        From desktop files to a <span className="accent">shared</span> back office
      </>
    ),
    lead: 'Banana Accounting is low-cost desktop software for people who keep their own books in files on their computer. Helvetly is an online back office the whole team works in at once, with reminders that send themselves, signatures and a client portal.',
    oursIf: [
      'work in the same records as a team, at the same time',
      'want reminders sent automatically, with fees and interest',
      'send contracts for signature and share documents in a client portal',
      'need e-invoices for Germany, Poland, Romania or Peppol BIS',
      'want an assistant who answers from your records',
    ],
    theirsIf: [
      'want desktop software that keeps your files on your own computer',
      'need double-entry bookkeeping at a low yearly price',
      'keep many clients’ books as an accountant on one subscription',
      'want a free plan for very small books',
    ],
    rows: {
      madeFor: 'Small companies, associations, private people and accountants',
      price: 'Free up to 70 transactions; Professional CHF 89 / year; Advanced CHF 179 / year',
      pricingModel: 'Yearly subscription per user, unlimited files',
      teamRoles: 'Multi-user subscriptions; one person edits a file at a time',
      documentTypes: 'Invoice and credit note; proforma in Advanced',
      contractTemplates: null,
      assistant: 'ChatGPT helpers outside the app (ChatGPT Plus)',
      aiImport: null,
      signIn: 'Local files with an optional file password',
      dataExport: 'Your files stay on your own computer',
      notifications: null,
      qrBill: true,
      invoiceLanguages: 'German, French, Italian, English',
      reminders: 'Printed by hand, up to three levels',
      depositPartial: null,
      instalments: null,
      einvoices: null,
      expenses: 'Entries linked to PDF receipts',
      vatReturn: 'Effective and net tax rate, with an XML file for the ESTV portal (Advanced)',
      signatures: null,
      clientPortal: null,
      retainers: null,
      auditLog: 'Locked entries with hash-chained control codes',
      apps: 'Windows, Mac and Linux; iOS, Android and a web app',
    },
  },
  {
    slug: 'cashctrl',
    name: 'CashCtrl',
    url: 'https://cashctrl.com',
    logo: '/brands/cashctrl.png',
    tone: 'mint',
    summary: 'Online double-entry accounting for people who keep their own books.',
    checked: '11 November 2026',
    title: (
      <>
        Less bookkeeping, <span className="accent">more</span> getting paid
      </>
    ),
    lead: 'CashCtrl is a capable online double-entry accounting package for people who know bookkeeping. Helvetly is for teams who want invoices, reminders, contracts and the VAT return to run on their own, on any device.',
    oursIf: [
      'want reminders sent automatically, with fees and interest',
      'send contracts for signature and share documents in a client portal',
      'need e-invoices for Germany, Poland, Romania or Peppol BIS',
      'want to work on your phone as well as your computer',
      'want an assistant who answers from your records',
    ],
    theirsIf: [
      'want full double-entry bookkeeping with year-end closing',
      'need a free plan for a single user',
      'run payroll for a few employees alongside the books',
      'manage several client companies as a fiduciary',
    ],
    rows: {
      madeFor: 'SMEs, freelancers and fiduciaries who know double-entry bookkeeping',
      price:
        'Free for 1 user; PRO CHF 350 / year with 3 users; extra users CHF 80 / year; incl. VAT',
      pricingModel: 'Free plan, then prepaid licences with paid extras per user and company',
      teamRoles: 'Roles for admins, guests and trustees, and custom ones (PRO)',
      documentTypes: 'Invoice and credit note; offers and more in PRO',
      contractTemplates: 'Letters from text templates',
      assistant: null,
      aiImport: null,
      signIn: 'Password, passkeys and two-factor',
      dataExport: 'Per module; documents as ZIP',
      notifications: null,
      qrBill: true,
      invoiceLanguages: 'German, French, Italian, English',
      reminders: 'Reminder documents, created by hand',
      depositPartial: null,
      instalments: null,
      einvoices: null,
      expenses: 'As purchase invoices',
      vatReturn: 'Effective and net tax rate, with an XML file for the ESTV portal',
      signatures: null,
      clientPortal: null,
      retainers: null,
      auditLog: true,
      apps: 'Web app for computers; phone browsers not supported',
    },
  },
  {
    slug: 'abaninja',
    name: 'AbaNinja',
    url: 'https://abaninja.ch',
    logo: '/brands/abaninja.png',
    tone: 'lilac',
    summary: 'Invoicing, accounting and payroll from the Abacus world, with a free plan.',
    checked: '11 November 2026',
    title: (
      <>
        Your back office, <span className="accent">beyond</span> Switzerland
      </>
    ),
    lead: 'AbaNinja packs invoicing, accounting and payroll from the Abacus world into one app with a free plan. Helvetly concentrates on the back office around your invoices, with e-invoices for Europe, retainers, the eCH-0217 VAT file and a hash-chained audit log.',
    oursIf: [
      'need e-invoices for Germany, Poland, Romania or Peppol BIS',
      'bill retainers and need to see the hours left',
      'want the eCH-0217 file to import your VAT return into the ePortal',
      'need a tamper-evident audit log of every financial change',
      'want every feature in every plan, with no add-on modules',
    ],
    theirsIf: [
      'want a free plan that includes accounting and payroll',
      'need payroll with ELM and salary certificates in the same tool',
      'want inventory, a shop or a till in one ecosystem',
      'expect to move to Abacus ERP later',
    ],
    rows: {
      madeFor: 'Swiss SMEs, startups, freelancers, associations and accountants',
      price: 'Starter free (1 user); Basic CHF 21 / month (3 users); Pro CHF 49 / month (5 users)',
      pricingModel: 'Free plan, then tiers limited by users, payroll runs and documents a year',
      teamRoles: 'User groups with permissions per area',
      documentTypes: 'Invoice, advance, partial, instalment and credit note',
      contractTemplates: null,
      assistant: 'SamurAI, acts after confirmation',
      aiImport: 'AI reads PDF invoices and receipts',
      signIn: 'Password, Google, Apple or Microsoft, optional two-factor',
      dataExport: 'Per application; no full database export',
      notifications: 'Email events chosen per user',
      qrBill: true,
      invoiceLanguages: 'German, French, Italian, English',
      reminders: 'Up to three levels, sent automatically or by hand',
      depositPartial: true,
      instalments: 'Instalment invoices from an order',
      einvoices: 'eBill and ZUGFeRD through the paid AbaNet add-on',
      expenses: true,
      vatReturn: 'Effective and net tax rate, as a guide for the ESTV form',
      signatures: 'Offer signing with DeepSign, paid',
      clientPortal: true,
      retainers: null,
      auditLog: null,
      apps: 'Web app; AbaClik for iOS and Android',
    },
  },
]

export const competitor = (slug: string) => COMPETITORS.find((c) => c.slug === slug)
