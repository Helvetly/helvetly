import { expect, object, test, text, uniqueName } from './fixtures'
import { list, objects, portalClient } from './scheduling-fixtures'

test('booking and weekly hours save through the scheduling settings page and shape the booking slots', async ({
  api,
  browser,
  page,
}) => {
  test.setTimeout(120_000)
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
  // Never saved: a usual week is suggested, still to be saved.
  await expect(hours.getByLabel('From, Monday')).toHaveValue('09:00')
  await expect(hours.getByLabel('To, Friday')).toHaveValue('17:00')
  await expect(hours.getByLabel('From, Saturday')).toHaveCount(0)

  await hours.getByLabel('From, Monday').selectOption('08:30')
  await hours.getByLabel('To, Monday').selectOption('16:30')
  await hours.getByRole('button', { name: /^Copy Monday.s hours to other days$/ }).click()
  await page.getByRole('menuitem', { name: 'Monday to Friday' }).click()
  await expect(hours.getByLabel('From, Friday')).toHaveValue('08:30')

  await hours.getByRole('switch', { name: 'Saturday' }).click()
  await hours.getByLabel('From, Saturday').selectOption('10:00')
  await hours.getByLabel('To, Saturday').selectOption('12:00')

  // A second range that overlaps the first is marked at once and cannot be saved.
  await hours.getByRole('button', { name: 'Add a time range on Monday' }).click()
  await hours.getByLabel('From, Monday').nth(1).selectOption('12:00')
  await expect(hours.getByText('Monday: Time ranges on one day can’t overlap.')).toBeVisible()
  await expect(hours.getByLabel('From, Monday').nth(1)).toHaveAttribute('aria-invalid', 'true')
  await hours.getByRole('button', { name: 'Remove a time range on Monday' }).nth(1).click()
  await expect(hours.getByText('Monday: Time ranges on one day can’t overlap.')).toHaveCount(0)

  await hours.getByRole('button', { name: 'Save', exact: true }).click()
  const weekly = [
    ...[1, 2, 3, 4, 5].map((day) => ({ day, start: '08:30', end: '16:30' })),
    { day: 6, start: '10:00', end: '12:00' },
  ]
  await expect.poll(async () => (await api.read('/scheduling/hosts/me')).weekly).toEqual(weekly)

  await page.reload()
  await expect(booking.getByRole('radio', { name: 'Review each one' })).toBeChecked()
  await expect(hours.getByLabel('From, Friday')).toHaveValue('08:30')
  await expect(hours.getByLabel('To, Saturday')).toHaveValue('12:00')
  await expect(hours.getByRole('switch', { name: 'Sunday' })).not.toBeChecked()
  await expect(hours.getByLabel('From, Sunday')).toHaveCount(0)

  // The booking page offers exactly those hours: on a Saturday, 60-minute sessions start 10:00–11:00 Zurich time.
  const type = await api.save('/scheduling/event-types', {
    name: uniqueName('Saturday lesson'),
    duration_minutes: 60,
    mode: 'live',
  })
  const client = await portalClient(api, browser)
  const saturday = new Date(Date.now() + 2 * 24 * 3_600_000)
  while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() + 1)
  saturday.setUTCHours(0, 0, 0, 0)
  const slotsOn = async (day: Date) =>
    (
      await list(
        await client.get(
          `/booking/slots?event_type_id=${text(type.id)}&from=${new Date(day.getTime() - 2 * 3_600_000).toISOString()}&to=${new Date(day.getTime() + 22 * 3_600_000).toISOString()}`,
        ),
      )
    ).map((slot) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Zurich',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(text(slot.starts_at))),
    )
  const offered = await slotsOn(saturday)
  expect(offered).toContain('10:00')
  expect(offered).toContain('11:00')
  expect(offered.every((clock) => clock >= '10:00' && clock <= '11:00')).toBe(true)
  expect(await slotsOn(new Date(saturday.getTime() + 24 * 3_600_000))).toEqual([])
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
