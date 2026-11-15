import type { Metadata } from 'next'

import { EmploymentSettings } from '@/components/settings/employment-settings'

export const metadata: Metadata = { title: 'Employment' }

export default function EmploymentPage() {
  return <EmploymentSettings />
}
