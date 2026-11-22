// The workspace's reply-to email for client email (GET/PUT /workspace/reply-to), as the Go API answers.
import { http, HttpResponse } from 'msw'

let replyTo: string | null = null

export function resetReplyTo(to: string | null = null) {
  replyTo = to
}

const answer = () => HttpResponse.json({ data: { reply_to_email: replyTo } })

export const replyToHandlers = [
  http.get('/api/v1/workspace/reply-to', answer),
  http.put<never, { reply_to_email: string }>('/api/v1/workspace/reply-to', async ({ request }) => {
    const address = (await request.json()).reply_to_email.trim().toLowerCase()
    if (address && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      return HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Enter a valid email address.',
            details: { fields: { reply_to_email: 'Enter a valid email address.' } },
          },
        },
        { status: 422 },
      )
    replyTo = address || null
    return answer()
  }),
]
