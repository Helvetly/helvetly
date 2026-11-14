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
import type { Tone } from '@/lib/tones'

/** The help center's topics, in the order a new customer meets the product. `name` is the articles' category. */
export const HELP_TOPICS: { name: string; blurb: string; icon: LucideIcon; tone: Tone }[] = [
  {
    name: 'Getting started',
    blurb: 'Find your way around, shortcuts and bringing your data in.',
    icon: BookOpen,
    tone: 'mint',
  },
  {
    name: 'Invoices and getting paid',
    blurb: 'QR bills, sending, payments, reminders, instalments and e-invoices.',
    icon: FileText,
    tone: 'peach',
  },
  {
    name: 'Clients',
    blurb: 'Clients, contact persons and the client portal.',
    icon: Building2,
    tone: 'sky',
  },
  {
    name: 'Expenses',
    blurb: 'Receipts in, expenses booked, reimbursements marked.',
    icon: Receipt,
    tone: 'lemon',
  },
  {
    name: 'Documents and signatures',
    blurb: 'Files, sharing, templates and PDFs sent for signature.',
    icon: FileSignature,
    tone: 'lilac',
  },
  {
    name: 'Engagements',
    blurb: 'Retainers, logged work and the invoices that follow.',
    icon: CalendarRange,
    tone: 'rose',
  },
  {
    name: 'VAT and books',
    blurb: 'The VAT return, closed months and the audit log.',
    icon: Landmark,
    tone: 'mint',
  },
  {
    name: 'Team and workspace',
    blurb: 'Workspaces, members, roles, your plan and data export.',
    icon: UsersRound,
    tone: 'sky',
  },
  {
    name: 'Account and security',
    blurb: 'Profile, passkeys, two-factor, sessions and notifications.',
    icon: ShieldCheck,
    tone: 'lilac',
  },
  {
    name: 'Heidi',
    blurb: 'Ask Heidi about your records and let her do the busywork.',
    icon: Sparkles,
    tone: 'lilac',
  },
]

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

export function helpTopic(name: string) {
  return HELP_TOPICS.find((topic) => topic.name === name)
}

/** Each topic with its articles; topics without any are left out. */
export function topicsWithArticles(articles: Article[]) {
  return HELP_TOPICS.map((topic) => ({
    ...topic,
    slug: topicSlug(topic.name),
    articles: articles.filter((a) => a.category === topic.name),
  })).filter((topic) => topic.articles.length > 0)
}
