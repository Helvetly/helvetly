'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function RedirectToWorkspaceEmails() {
  const router = useRouter()
  useEffect(() => router.replace('/settings/workspace#email-template-pick'), [router])
  return null
}
