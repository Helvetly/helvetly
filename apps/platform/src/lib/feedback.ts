import { request } from '@/lib/api'

export type FeedbackKind = 'problem' | 'feature'

export const FEEDBACK_KINDS: { value: FeedbackKind; label: string }[] = [
  { value: 'problem', label: 'Report a problem' },
  { value: 'feature', label: 'Suggest a feature' },
]
export const MAX_DESCRIPTION = 5000
export const MAX_SCREENSHOTS = 5
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Why these screenshots cannot be sent, or an empty string (docs/feedback-contract.md). */
export function screenshotError(files: File[]): string {
  if (files.length > MAX_SCREENSHOTS) return `Attach at most ${MAX_SCREENSHOTS} screenshots.`
  const bad = files.find((file) => !SCREENSHOT_TYPES.includes(file.type))
  if (bad) return `${bad.name} is not a PNG, JPEG or WebP image.`
  const big = files.find((file) => file.size > MAX_SCREENSHOT_BYTES)
  if (big) return `${big.name} is larger than 5 MB.`
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
