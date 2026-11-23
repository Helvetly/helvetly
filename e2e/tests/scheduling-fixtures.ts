import { randomUUID } from 'node:crypto'

import type { APIRequestContext, Browser } from '@playwright/test'

import {
  expect,
  object,
  portalPath,
  portalURL,
  text,
  uniqueName,
  type FinancialAPI,
} from './fixtures'

/** The wall-clock time of an instant in Zurich, "2026-12-01T09:00", as EventInput's starts_local. */
export function zurichLocal(at: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Zurich',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/** `minutes` from now, on a five-minute step. */
export function soon(minutes: number) {
  const step = 5 * 60_000
  return new Date(Math.ceil((Date.now() + minutes * 60_000) / step) * step)
}

export type ICSProperty = { params: Record<string, string>; value: string }
export type ICSComponent = Record<string, ICSProperty[]>

/** Parses an iCalendar file (RFC 5545: unfolded lines, `NAME;PARAM=V:value`) into its calendar and its events. */
export function parseICS(body: string) {
  expect(body.startsWith('BEGIN:VCALENDAR\r\n'), 'CRLF line endings, a calendar').toBe(true)
  const lines = body
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .filter(Boolean)
  for (const line of body.split('\r\n'))
    expect(
      new TextEncoder().encode(line).length,
      `folded at 75 octets: ${line}`,
    ).toBeLessThanOrEqual(75)
  const stack: ICSComponent[] = []
  const calendar: ICSComponent = {}
  const events: ICSComponent[] = []
  for (const line of lines) {
    const colon = line.indexOf(':')
    const head = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const [name = '', ...rest] = head.split(';')
    if (name === 'BEGIN') {
      const component: ICSComponent = {}
      if (value === 'VEVENT') events.push(component)
      stack.push(value === 'VCALENDAR' ? calendar : component)
      continue
    }
    if (name === 'END') {
      stack.pop()
      continue
    }
    const params = Object.fromEntries(
      rest.map((param) => [
        param.slice(0, param.indexOf('=')),
        param.slice(param.indexOf('=') + 1),
      ]),
    )
    const current = stack.at(-1)
    if (!current) throw new Error(`Property outside a component: ${line}`)
    ;(current[name] ??= []).push({ params, value })
  }
  expect(stack).toEqual([])
  return { calendar, events }
}

export const prop = (component: ICSComponent | undefined, name: string) => component?.[name]?.[0]

/** A client of the workspace with the portal on, signed in to it in a context of its own. */
export async function portalClient(api: FinancialAPI, browser: Browser) {
  const email = `sched-${randomUUID()}@example.test`
  const client = await api.save('/clients', {
    name: uniqueName('Müller'),
    is_company: false,
    email,
    language: 'en',
  })
  await api.save(`/clients/${text(client.id)}`, { portal_enabled: true }, 'PATCH')
  const prefix = await portalPath(api.request)
  const context = await browser.newContext({ baseURL: portalURL })
  let sent = await context.request.post(`${prefix}api/v1/public/portal/auth/start`, {
    data: { email },
  })
  if (sent.status() === 429) {
    const seconds = Number(object(object(object(await sent.json()).error).details).resend_in)
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000))
    sent = await context.request.post(`${prefix}api/v1/public/portal/auth/start`, {
      data: { email },
    })
  }
  expect(sent.status()).toBe(202)
  const dev = await context.request.get(
    `/api/v1/auth/email/dev-code?email=${encodeURIComponent(email)}`,
  )
  await expect(dev).toBeOK()
  const verified = await context.request.post(`${prefix}api/v1/public/portal/auth/verify`, {
    data: { email, code: text(object(await dev.json()).code) },
  })
  expect(verified.status()).toBe(201)
  const csrf = text(object(await verified.json()).csrf_token)
  const base = `${prefix}api/v1/public/portal/scheduling`
  return {
    client,
    context,
    prefix,
    get: (path: string) => context.request.get(`${base}${path}`),
    post: (path: string, data: unknown = {}) =>
      context.request.post(`${base}${path}`, { data, headers: { 'X-CSRF-Token': csrf } }),
    close: () => context.close(),
  }
}

/** A list of API objects. */
export function objects(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Expected a list')
  return value.map(object)
}

/** The answer's `data` as a list. */
export async function list(response: Awaited<ReturnType<APIRequestContext['get']>>) {
  await expect(response).toBeOK()
  return objects(object(await response.json()).data)
}

export type PortalClient = Awaited<ReturnType<typeof portalClient>>
