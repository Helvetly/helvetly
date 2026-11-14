'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function RedirectToAccount() {
  const router = useRouter()
  useEffect(() => router.replace('/account#sign-in'), [router])
  return null
}
