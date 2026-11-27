import { http, HttpResponse } from 'msw'

import type { Client } from '@/lib/clients'

function change(client: Client, archive: boolean) {
  if (Boolean(client.archived_at) === archive) return false
  client.archived_at = archive ? new Date().toISOString() : null
  if (!archive) client.is_active = false
  return true
}

export function clientArchiveHandlers(clients: Client[]) {
  return [
    ...(['archive', 'unarchive'] as const).map((action) =>
      http.post<{ id: string }>(`/api/v1/clients/:id/${action}`, ({ params }) => {
        const client = clients.find(({ id }) => id === params.id)
        if (!client)
          return HttpResponse.json(
            { error: { code: 'not_found', message: 'Not found.' } },
            { status: 404 },
          )
        change(client, action === 'archive')
        return HttpResponse.json({ data: client })
      }),
    ),
    http.post<never, { ids: string[]; action: string }>(
      '/api/v1/clients/bulk',
      async ({ request }) => {
        const { ids, action } = await request.json()
        if (action !== 'archive' && action !== 'unarchive') return
        const updated = clients.filter(
          (client) => ids.includes(client.id) && change(client, action === 'archive'),
        )
        return HttpResponse.json({ data: { updated: updated.length } })
      },
    ),
  ]
}
