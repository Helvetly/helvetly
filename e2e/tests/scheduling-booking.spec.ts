import { expect, object, test, text, uniqueName } from './fixtures'
import { list, objects, portalClient } from './scheduling-fixtures'

test('booking and weekly hours save through the scheduling settings page', async ({
  api,
  page,
}) => {
  await page.goto('/settings/scheduling')

  const booking = page.getByRole('region', { name: 'Booking', exact: true })
  await booking.getByRole('radio', { name: 'Clients too' }).check()
  await booking.getByRole('radio', { name: 'Review each one' }).check()
  await booking.getByRole('button', { name: 'Save', exact: true }).click()

  await expect
    .poll(() => api.read('/scheduling/settings'))
    .toMatchObject({
      booking_mode: 'clients',
      confirmation: 'manual',
      notice_minutes: 1440,
    })

  const hours = page.getByRole('region', { name: 'Weekly hours', exact: true })
  await hours.getByLabel('Start time', { exact: true }).fill('08:30')
  await hours.getByLabel('End time', { exact: true }).fill('16:30')
  await hours.getByRole('button', { name: 'Add to selected days' }).click()
  await hours.getByRole('button', { name: 'Save', exact: true }).click()

  const weekly = [1, 2, 3, 4, 5].map((day) => ({ day, start: '08:30', end: '16:30' }))
  await expect.poll(() => api.read('/scheduling/hosts/me')).toMatchObject({ weekly })

  await page.reload()
  await expect(booking.getByRole('radio', { name: 'Review each one' })).toBeChecked()
  await expect(hours.getByLabel('From, Friday')).toHaveValue('08:30')
  await expect(hours.getByLabel('From, Saturday')).toHaveCount(0)

  await hours.getByRole('button', { name: 'Every day', exact: true }).click()
  await hours.getByLabel('Start time', { exact: true }).fill('17:00')
  await hours.getByLabel('End time', { exact: true }).fill('18:00')
  await hours.getByRole('button', { name: 'Add to selected days' }).click()
  await hours.getByRole('button', { name: 'Save', exact: true }).click()

  const evening = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, start: '17:00', end: '18:00' }))
  const allHours = [...weekly, ...evening].toSorted(
    (a, b) => a.day - b.day || a.start.localeCompare(b.start),
  )
  await expect.poll(async () => (await api.read('/scheduling/hosts/me')).weekly).toEqual(allHours)
})

test('clients book in the portal: two at once for one slot, one wins; manual confirmation holds the slot until staff approve', async ({
  api,
  browser,
}) => {
  test.setTimeout(120_000)
  await api.save('/scheduling/settings', { booking_mode: 'clients', confirmation: 'auto' }, 'PUT')
  const weekly = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, start: '08:00', end: '18:00' }))
  await api.save('/scheduling/hosts/me', { weekly }, 'PUT')
  const typeName = uniqueName('Trial lesson')
  const type = await api.save('/scheduling/event-types', {
    name: typeName,
    duration_minutes: 60,
    mode: 'live',
  })
  const ann = await portalClient(api, browser)
  const ben = await portalClient(api, browser)

  const offer = object(object(await (await ann.get('/booking')).json()))
  expect(offer.mode).toBe('clients')
  const types = objects(offer.event_types)
  expect(types.map((entry) => entry.name)).toContain(typeName)

  // A day well beyond the 12 h minimum notice: a whole day of free slots.
  const from = new Date(Date.now() + 2 * 24 * 3_600_000)
  from.setUTCHours(0, 0, 0, 0)
  const to = new Date(from.getTime() + 24 * 3_600_000)
  const slotsOf = async () =>
    list(
      await ann.get(
        `/booking/slots?event_type_id=${text(type.id)}&from=${from.toISOString()}&to=${to.toISOString()}`,
      ),
    )
  const slots = await slotsOf()
  expect(slots.length).toBeGreaterThanOrEqual(2)
  const [contested, held] = slots.map((slot) => text(slot.starts_at))
  if (!contested || !held) throw new Error('Expected two slots')

  // Both ask for the same slot at once: one booking, one "just taken".
  const book = (who: typeof ann, startsAt: string) =>
    who.post('/booking', {
      event_type_id: text(type.id),
      starts_at: startsAt,
      note: 'First lesson',
    })
  const answers = await Promise.all([book(ann, contested), book(ben, contested)])
  const statuses = answers.map((answer) => answer.status()).toSorted()
  expect(statuses).toEqual([201, 409])
  const loser = answers.find((answer) => answer.status() === 409)
  expect(object(object(await loser?.json()).error).code).toBe('slot_taken')
  const winner = object(
    object(await answers.find((answer) => answer.status() === 201)?.json()).data,
  )
  expect(winner.status).toBe('scheduled')
  expect((await slotsOf()).map((slot) => slot.starts_at)).not.toContain(contested)
  // Staff see the booked session in their calendar.
  const booked = await api.read(`/scheduling/occurrences/${text(winner.id)}`)
  expect(new Date(text(booked.starts_at)).toISOString()).toBe(new Date(contested).toISOString())

  // Manual confirmation: the booking waits (and holds the slot) until staff approve it.
  await api.save('/scheduling/settings', { confirmation: 'manual' }, 'PUT')
  const waiting = await book(ann, held)
  expect(waiting.status(), await waiting.text()).toBe(201)
  const requested = object(object(await waiting.json()).data)
  expect(requested.status).toBe('requested')
  expect((await slotsOf()).map((slot) => slot.starts_at)).not.toContain(held)
  const taken = await book(ben, held)
  expect(taken.status()).toBe(409)

  const requests = await list(await api.request.get('/api/v1/scheduling/requests'))
  const booking = requests.find((request) => request.occurrence_id === requested.id)
  expect(booking).toMatchObject({ kind: 'booking', status: 'pending' })
  const approved = await api.save(`/scheduling/requests/${text(booking?.id)}/approve`, {})
  expect(approved).toMatchObject({ id: requested.id, status: 'scheduled' })
  const upcoming = await list(await ann.get('/occurrences?when=upcoming'))
  expect(upcoming.find((session) => session.id === requested.id)).toMatchObject({
    status: 'scheduled',
  })

  // Each client sees only their own sessions.
  expect((await ben.get(`/occurrences/${text(requested.id)}/ics`)).status()).toBe(404)
  const own = await ann.get(`/occurrences/${text(requested.id)}/ics`)
  await expect(own).toBeOK()
  expect(await own.text()).toContain('METHOD:PUBLISH')
  expect((await list(await ben.get('/occurrences?when=upcoming'))).map((s) => s.id)).not.toContain(
    requested.id,
  )

  // Booking off: the portal refuses new bookings.
  await api.save('/scheduling/settings', { booking_mode: 'staff' }, 'PUT')
  const off = await book(ann, text(slots.at(-1)?.starts_at))
  expect(off.status()).toBe(409)
  expect(object(object(await off.json()).error).code).toBe('booking_off')
  await ann.close()
  await ben.close()
})
