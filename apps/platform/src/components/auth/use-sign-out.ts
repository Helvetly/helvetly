'use client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { api, errorMessage, changeSession } from '@/lib/api'
import { refusedScope } from '@/lib/permissions'
import { isUnreachable } from '@/lib/unreachable'

export function useSignOut(login = '/login') {
  const router = useRouter()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.signOut,
    networkMode: 'always',
    onSuccess: () => {
      changeSession('')
      queryClient.clear()
      router.replace(login)
    },
    onError: (error) => {
      // The provider already reports an unreachable API or a refused scope.
      if (!isUnreachable(error) && !refusedScope(error)) toast.error(errorMessage(error))
    },
  })
}
