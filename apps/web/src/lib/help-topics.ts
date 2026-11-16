import type { Locale } from '@helvetly/i18n'
import {
  BookOpen,
  Building2,
  CalendarRange,
  FileSignature,
  FileText,
  Landmark,
  type LucideIcon,
  Receipt,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react'

import type { Article } from '@/lib/content'
import { perLanguage } from '@/lib/i18n'
import type { Tone } from '@/lib/tones'

/** The help center's topics, in the order a new customer meets the product. `name` is the articles' category. */
export const helpTopicsIn = perLanguage(
  (translate): { name: string; blurb: string; icon: LucideIcon; tone: Tone }[] => [
    {
      name: 'Getting started',
      blurb: translate('findYourWayAroundShortcutsAndBringingYourData'),
      icon: BookOpen,
      tone: 'mint',
    },
    {
      name: 'Invoices and getting paid',
      blurb: translate('qrBillsSendingPaymentsRemindersInstalmentsAndEInvoices'),
      icon: FileText,
      tone: 'peach',
    },
    {
      name: 'Clients',
      blurb: translate('clientsContactPersonsAndTheClientPortal'),
      icon: Building2,
      tone: 'sky',
    },
    {
      name: 'Expenses',
      blurb: translate('receiptsInExpensesBookedReimbursementsMarked'),
      icon: Receipt,
      tone: 'lemon',
    },
    {
      name: 'Documents and signatures',
      blurb: translate('filesSharingTemplatesAndPDFsSentForSignature'),
      icon: FileSignature,
      tone: 'lilac',
    },
    {
      name: 'Engagements',
      blurb: translate('retainersLoggedWorkAndTheInvoicesThatFollow'),
      icon: CalendarRange,
      tone: 'rose',
    },
    {
      name: 'VAT and books',
      blurb: translate('theVATReturnClosedMonthsAndTheAuditLog'),
      icon: Landmark,
      tone: 'mint',
    },
    {
      name: 'Team and workspace',
      blurb: translate('workspacesMembersRolesYourPlanAndDataExport'),
      icon: UsersRound,
      tone: 'sky',
    },
    {
      name: 'Account and security',
      blurb: translate('profilePasskeysTwoFactorSessionsAndNotifications'),
      icon: ShieldCheck,
      tone: 'lilac',
    },
    {
      name: 'Heidi',
      blurb: translate('askHeidiAboutYourRecordsAndLetHerDo'),
      icon: Sparkles,
      tone: 'lilac',
    },
  ],
)

/** What people come for most, shown first. */
export const POPULAR_HELP = [
  'create-and-issue-an-invoice',
  'swiss-qr-bill',
  'payment-reminders-dunning',
  'import-records-with-ai',
  'swiss-vat-return',
  'invite-a-team-member',
]

// Kept here, not imported from lib/legal, because the client help center imports this file.
export const topicSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

export function helpTopic(name: string, language: Locale) {
  return helpTopicsIn(language).find((topic) => topic.name === name)
}

/** Each topic with its articles; topics without any are left out. */
export function topicsWithArticles(articles: Article[], language: Locale) {
  return helpTopicsIn(language)
    .map(({ name, blurb, icon, tone }) => ({
      name,
      blurb,
      icon,
      tone,
      slug: topicSlug(name),
      articles: articles.filter((a) => a.category === name),
    }))
    .filter((topic) => topic.articles.length > 0)
}
