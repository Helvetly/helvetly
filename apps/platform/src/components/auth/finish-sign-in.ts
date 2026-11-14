'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'

import { setCsrfToken, type SignedIn } from '@/lib/api'
import { safeNextPath } from '@/lib/safe'

/** After a successful sign-in: forget anything cached for a previous session and go on. */
export function useFinishSignIn() {
  const router = useRouter()
  const queryClient = useQueryClient()

  return (signedIn: SignedIn) => {
    setCsrfToken(signedIn.csrf_token)
    queryClient.clear()
    router.replace(safeNextPath(signedIn.next))
  }
}
