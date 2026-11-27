'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Sends an old address on to its page, keeping the query (a notification's `?period=`) and the section (`#mcp`). */
export function RedirectTo({ href }: { href: string }) {
  const router = useRouter()
  useEffect(
    () => router.replace(`${href}${window.location.search}${window.location.hash}`),
    [router, href],
  )
  return null
}
