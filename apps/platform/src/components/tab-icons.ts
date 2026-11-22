import {
  Briefcase,
  CreditCard,
  FileCheck,
  FileText,
  Files,
  Handshake,
  History,
  LayoutDashboard,
  Mail,
  ReceiptText,
  Users,
  Wallet,
} from 'lucide-react'

/** One icon per concept for the line tabs of every detail drawer, so the same tab looks the same everywhere. */
export const tabIcons = {
  overview: LayoutDashboard,
  payments: CreditCard,
  emails: Mail,
  pdf: FileText,
  contacts: Users,
  files: Files,
  invoices: ReceiptText,
  quotes: FileCheck,
  engagements: Handshake,
  employment: Briefcase,
  pay: Wallet,
  documents: Files,
  history: History,
} as const
