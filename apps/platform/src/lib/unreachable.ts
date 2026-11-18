import { toast } from 'sonner'

import { ApiError } from '@/lib/api'
import { translate } from '@/lib/i18n'

/** No answer, or the proxy's 502/503/504 while the API is down: the server, not the request, is the problem. */
export const isUnreachable = (error: unknown) =>
  error instanceof ApiError && (error.status === 0 || [502, 503, 504].includes(error.status))

/** One toast however many requests failed at once; reports whether it was such an error. */
export function toastUnreachable(error: unknown): boolean {
  if (!isUnreachable(error)) return false
  toast.error(translate('cannotReachHelvetlyCheckYourConnection'), { id: 'server-unreachable' })
  return true
}
