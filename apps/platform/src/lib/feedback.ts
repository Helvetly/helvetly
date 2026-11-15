import { request } from '@/lib/api'
import { translate } from '@/lib/i18n'

export type FeedbackKind = 'problem' | 'feature'

export const FEEDBACK_KINDS: { value: FeedbackKind; label: string }[] = [
  { value: 'problem', label: translate('reportAProblem') },
  { value: 'feature', label: translate('suggestAFeature') },
]
export const MAX_DESCRIPTION = 5000
export const MAX_SCREENSHOTS = 5
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Why these screenshots cannot be sent, or an empty string (docs/feedback-contract.md). */
export function screenshotError(files: File[]): string {
  if (files.length > MAX_SCREENSHOTS)
    return translate('attachAtMostScreenshots', { MAX_SCREENSHOTS: MAX_SCREENSHOTS })
  const bad = files.find((file) => !SCREENSHOT_TYPES.includes(file.type))
  if (bad) return translate('isNotAPNGJPEGOrWebPImage', { name: bad.name })
  const big = files.find((file) => file.size > MAX_SCREENSHOT_BYTES)
  if (big) return translate('isLargerThan5MB', { name: big.name })
  return ''
}

export type FeedbackInput = { kind: FeedbackKind; description: string; screenshots: File[] }

export const feedbackApi = {
  send: ({ kind, description, screenshots }: FeedbackInput) => {
    const form = new FormData()
    form.append('kind', kind)
    form.append('description', description.trim())
    form.append('page_path', window.location.pathname)
    for (const file of screenshots) form.append('screenshots[]', file)
    return request<{ id: string }>('/feedback', { method: 'POST', form })
  },
}
