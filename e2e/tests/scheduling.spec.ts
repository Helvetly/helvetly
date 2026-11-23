import { randomUUID } from 'node:crypto'

import { expect, join, object, portalURL, signIn, test, text, today, uniqueName } from './fixtures'
import {
  list,
  objects,
  parseICS,
  portalClient,
  prop,
  soon,
  zurichLocal,
} from './scheduling-fixtures'

test('a weekly series on an engagement: its calendar file, one session moved, a late cancellation from the portal, the used session invoiced', async ({
  api,
  browser,
  baseURL,
  page,
}) => {
  test.setTimeout(120_000)
  const portal = await portalClient(api, browser)
  const clientID = text(portal.client.id)
  const engagement = await api.save('/engagements', {
    client_id: clientID,
    title: uniqueName('Coaching package'),
    quantity: '10',
    unit: 'hour',
    billing: 'arrears',
    unit_price: '100',
    price_basis: 'net',
    currency: 'CHF',
    vat_category: 'S',
    vat_rate: '8.1',
    start_date: today(),
    recurrence: 'monthly',
  })
  const title = uniqueName('Weekly coaching')
  // The first session is inside the default 24 h notice, so cancelling it is late.
  const first = soon(90)
  const created = await api.write('/scheduling/events', {
    client_id: clientID,
    engagement_id: text(engagement.id),
    title,
    starts_local: zurichLocal(first),
    time_zone: 'Europe/Zurich',
    duration_minutes: 60,
    mode: 'live',
    location: 'Bahnhofstrasse 1, Zürich',
    recurrence: { freq: 'weekly', interval: 1, count: 3 },
  })
  expect(created.status(), await created.text()).toBe(201)
  const answer = object(object(await created.json()).data)
  const event = object(answer.event)
  expect(text(object(event.recurrence).rrule)).toContain('FREQ=WEEKLY')
  expect(text(object(event.recurrence).rrule)).toContain('COUNT=3')
  const sessions = objects(answer.occurrences)
  expect(sessions).toHaveLength(3)
  expect(sessions.map((session) => session.status)).toEqual(['scheduled', 'scheduled', 'scheduled'])
  expect(new Date(text(sessions[0]?.starts_at)).getTime()).toBe(first.getTime())
  const [cancelled, moved] = sessions
  if (!cancelled || !moved) throw new Error('Expected the sessions')

  // The calendar file names the series and this session's slot in it (RFC 5545).
  const icsOf = async (id: string) => {
    const response = await api.request.get(`/api/v1/scheduling/occurrences/${id}/ics`)
    await expect(response).toBeOK()
    expect(response.headers()['content-type']).toContain('text/calendar')
    return parseICS(await response.text())
  }
  const before = await icsOf(text(moved.id))
  expect(prop(before.calendar, 'METHOD')?.value).toBe('PUBLISH')
  expect(before.events).toHaveLength(1)
  const [vevent] = before.events
  expect(prop(vevent, 'UID')?.value).toBe(`${text(event.id)}@localhost`)
  expect(prop(vevent, 'SEQUENCE')?.value).toBe('0')
  expect(prop(vevent, 'SUMMARY')?.value).toBe(title)
  expect(prop(vevent, 'LOCATION')?.value).toBe('Bahnhofstrasse 1\\, Zürich')
  expect(prop(vevent, 'DTSTART')?.params.TZID).toBe('Europe/Zurich')
  const recurrenceID = prop(vevent, 'RECURRENCE-ID')
  expect(recurrenceID?.value).toMatch(/^\d{8}T\d{6}$/)

  // Moving one session ("this") keeps its identity and raises its sequence.
  const later = new Date(new Date(text(moved.starts_at)).getTime() + 60 * 60_000)
  const changed = await api.save(
    `/scheduling/occurrences/${text(moved.id)}`,
    { scope: 'this', starts_local: zurichLocal(later), notify: true },
    'PATCH',
  )
  expect(changed).toMatchObject({
    id: moved.id,
    status: 'rescheduled',
    is_exception: true,
    original_start: moved.original_start,
    sequence: Number(moved.sequence) + 1,
  })
  expect(new Date(text(changed.starts_at)).getTime()).toBe(later.getTime())
  const after = await icsOf(text(moved.id))
  const [updated] = after.events
  expect(prop(updated, 'UID')?.value).toBe(prop(vevent, 'UID')?.value)
  expect(prop(updated, 'SEQUENCE')?.value).toBe('1')
  expect(prop(updated, 'RECURRENCE-ID')).toEqual(recurrenceID)
  expect(prop(updated, 'DTSTART')?.value).not.toBe(prop(vevent, 'DTSTART')?.value)
  // The other sessions of the series did not move.
  expect(object(await api.read(`/scheduling/occurrences/${text(sessions[2]?.id)}`)).status).toBe(
    'scheduled',
  )

  // The client sees the series in the portal and asks to cancel the first session: late, so it waits.
  const upcoming = await list(await portal.get('/occurrences?when=upcoming'))
  const mine = upcoming.find((session) => session.id === cancelled.id)
  expect(mine).toMatchObject({ title, status: 'scheduled', can_cancel: true })
  expect(JSON.stringify(upcoming)).not.toContain('unit_price')
  const asked = await portal.post(`/occurrences/${text(cancelled.id)}/cancel-request`, {
    note: 'Sorry, something came up',
  })
  expect(asked.status(), await asked.text()).toBe(201)
  const requestData = object(object(await asked.json()).data)
  expect(requestData).toMatchObject({ kind: 'cancel', status: 'pending', late: true })
  const page2 = await portal.context.newPage()
  await page2.goto(`${portalURL}${portal.prefix}sessions`)
  await expect(page2.getByText(title).first()).toBeVisible()
  await page2.close()

  // Staff see the request and approve it: a late cancellation that uses a session of the package.
  const waiting = await list(await api.request.get('/api/v1/scheduling/requests'))
  const pending = waiting.find((item) => item.id === requestData.id)
  expect(pending).toMatchObject({ kind: 'cancel', late: true, status: 'pending' })
  const approved = await api.save(`/scheduling/requests/${text(requestData.id)}/approve`, {})
  expect(approved).toMatchObject({
    id: cancelled.id,
    status: 'cancelled_late',
    late: true,
    counts: true,
  })
  expect(approved.entry_ids).toHaveLength(1)

  const entries = await list(
    await api.request.get(`/api/v1/engagements/${text(engagement.id)}/entries`),
  )
  expect(entries).toHaveLength(1)
  const [entry] = entries
  expect(Number(entry?.quantity)).toBe(1)
  expect(text(entry?.note)).toContain(title)

  // The used session is invoiced with the engagement's period.
  const period = text(entry?.period_id)
  const billed = await api.save(`/engagements/${text(engagement.id)}/periods/${period}/invoice`, {
    kind: 'usage',
  })
  const invoice = await api.read(`/invoices/${text(billed.invoice_id)}`)
  expect(invoice.net_total).toBe('100.00')
  // Its entry is on an invoice now, so the late cancellation can no longer be waived.
  const waive = await api.write(`/scheduling/occurrences/${text(cancelled.id)}/attendance`, {
    waive: true,
    reason: 'Goodwill',
  })
  expect(waive.status()).toBe(409)
  expect(object(object(await waive.json()).error).code).toBe('entry_invoiced')

  // The drawer opens the session in place from its link.
  await page.goto(`/scheduling?session=${text(moved.id)}`)
  await expect(page.getByRole('dialog').getByText(title).first()).toBeVisible()

  // A member who may only read sees the sessions but cannot schedule; another workspace sees nothing.
  const reader = await join(api, browser, baseURL, 'Rita Reader')
  expect(
    (await reader.api.request.get(`/api/v1/scheduling/occurrences/${text(moved.id)}`)).status(),
  ).toBe(200)
  const refused = await reader.api.write('/scheduling/events', {
    client_id: clientID,
    title: 'Not allowed',
    starts_local: zurichLocal(soon(60 * 24 * 3)),
    duration_minutes: 30,
  })
  expect(refused.status()).toBe(403)
  await reader.context.close()
  const strangerContext = await browser.newContext({ baseURL })
  const stranger = await signIn(strangerContext.request, `stranger-${randomUUID()}@example.test`)
  expect(
    (await stranger.request.get(`/api/v1/scheduling/occurrences/${text(moved.id)}`)).status(),
  ).toBe(404)
  expect(
    (
      await stranger.write(`/scheduling/occurrences/${text(moved.id)}/cancel`, { scope: 'this' })
    ).status(),
  ).toBe(404)
  await strangerContext.close()
  await portal.close()
})
