// The workspace's client email switches and footer (GET/PUT /workspace/client-emails), as the Go API answers.
import { http, HttpResponse } from 'msw'

import type { ClientEmails } from '@/lib/workspaces'

const initial: ClientEmails = {
  email_footer: '',
  portal_invitations: true,
  session_reminders: true,
}
let current = { ...initial }
export const clientEmailChanges: Partial<ClientEmails>[] = []

export function resetClientEmails(over: Partial<ClientEmails> = {}) {
  current = { ...initial, ...over }
  clientEmailChanges.length = 0
}

const answer = () => HttpResponse.json({ data: current })

export const clientEmailsHandlers = [
  http.get('/api/v1/workspace/client-emails', answer),
  http.put<never, Partial<ClientEmails>>('/api/v1/workspace/client-emails', async ({ request }) => {
    const change = await request.json()
    const footer = (change.email_footer ?? '').trim()
    if ([...footer].length > 300 || footer.split('\n').length > 4) {
      const message = 'Enter at most 4 lines and 300 characters.'
      return HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message,
            details: { fields: { email_footer: message } },
          },
        },
        { status: 422 },
      )
    }
    clientEmailChanges.push(change)
    current = { ...current, ...change }
    return answer()
  }),
]
