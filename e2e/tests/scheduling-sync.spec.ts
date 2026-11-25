import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

import { expect, object, signIn, test, text, uniqueName } from './fixtures'
import { list, objects, soon, zurichLocal } from './scheduling-fixtures'

// calsync's fake Google, served by the API under test (HELVETLY_E2E_FAKE_CALENDARS in scripts/e2e-server.mjs).
const fake = '/api/test/fake-calendars/google/_test'

/** The fake calendar's event the occurrence was pushed as: its id and start. */
async function pushedAs(request: APIRequestContext, occurrenceID: string) {
  const response = await request.post(`${fake}/events`, { data: {} })
  await expect(response).toBeOK()
  const events = object(await response.json()).events
  const event = (Array.isArray(events) ? events.map(object) : []).find(
    (each) =>
      typeof each.Props === 'object' &&
      each.Props !== null &&
      object(each.Props).helvetly_occurrence === occurrenceID,
  )
  return event && { id: text(event.ID), start: text(event.Start) }
}

test('a host connects Google: the session is pushed, a move in Google comes back as a reschedule, disconnecting removes it', async ({
  api,
  browser,
  baseURL,
  page,
}) => {
  test.setTimeout(150_000)
  // The connect flow goes to the provider and back: state and PKCE in the cookie, the account checked on return.
  const landed = await page.request.get('/api/v1/scheduling/calendars/google/connect')
  expect(new URL(landed.url()).pathname).toBe('/settings/scheduling')
  expect(new URL(landed.url()).searchParams.get('calendar')).toBe('connected')
  const calendars = object(await (await api.request.get('/api/v1/scheduling/calendars')).json())
  expect(calendars.providers).toEqual(expect.arrayContaining(['google', 'microsoft']))
  const [connection] = objects(calendars.data)
  expect(connection).toMatchObject({
    provider: 'google',
    status: 'active',
    account_email: 'host@gmail.test',
  })
  expect(JSON.stringify(calendars)).not.toMatch(/"(at|rt)-/)

  const client = await api.client(uniqueName('Synced client'))
  const start = soon(60 * 24 * 3)
  const created = await api.save('/scheduling/events', {
    client_id: text(client.id),
    title: uniqueName('Synced session'),
    starts_local: zurichLocal(start),
    time_zone: 'Europe/Zurich',
    duration_minutes: 60,
    notify: false,
  })
  const [occurrence] = objects(created.occurrences)
  if (!occurrence) throw new Error('Expected the session')
  const id = text(occurrence.id)

  // The push worker puts it in the host's calendar (every 5 s).
  await expect
    .poll(async () => Boolean(await pushedAs(page.request, id)), { timeout: 45_000 })
    .toBe(true)
  const pushed = await pushedAs(page.request, id)
  expect(new Date(pushed?.start ?? '').getTime()).toBe(start.getTime())

  // The host drags it two hours later in Google; Sync now brings the move back as the host's reschedule.
  const movedStart = new Date(start.getTime() + 2 * 3_600_000)
  const movedEnd = new Date(movedStart.getTime() + 3_600_000)
  await expect(
    await page.request.post(`${fake}/move`, {
      data: { id: pushed?.id, start: movedStart.toISOString(), end: movedEnd.toISOString() },
    }),
  ).toBeOK()
  expect((await api.write(`/scheduling/calendars/${text(connection?.id)}/sync`)).status()).toBe(202)
  await expect
    .poll(
      async () => {
        const now = await api.read(`/scheduling/occurrences/${id}`)
        return new Date(text(now.starts_at)).getTime()
      },
      { timeout: 75_000, intervals: [2_000] },
    )
    .toBe(movedStart.getTime())
  const moved = await api.read(`/scheduling/occurrences/${id}`)
  expect(moved).toMatchObject({ status: 'rescheduled', is_exception: false })
  expect(Number(moved.sequence)).toBeGreaterThan(Number(occurrence.sequence))

  // Settings → Scheduling shows the connected calendar.
  await page.goto('/settings/scheduling')
  await expect(page.getByText('host@gmail.test').first()).toBeVisible()

  // Another workspace sees no connection of this one and cannot remove it.
  const otherContext = await browser.newContext({ baseURL })
  const other = await signIn(otherContext.request, `other-${randomUUID()}@example.test`)
  expect(await list(await other.request.get('/api/v1/scheduling/calendars'))).toEqual([])
  expect(
    (
      await other.write(`/scheduling/calendars/${text(connection?.id)}`, undefined, 'DELETE')
    ).status(),
  ).toBe(404)
  await otherContext.close()

  // Disconnecting removes the pushed event from Google.
  expect(
    (
      await api.write(`/scheduling/calendars/${text(connection?.id)}`, undefined, 'DELETE')
    ).status(),
  ).toBe(204)
  await expect
    .poll(async () => Boolean(await pushedAs(page.request, id)), { timeout: 20_000 })
    .toBe(false)
  expect(await list(await api.request.get('/api/v1/scheduling/calendars'))).toEqual([])
})
