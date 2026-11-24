import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { projectPlans } from '@/lib/offer'

import { pageUrl, toolsFor, WebMcp, type WebMcpTool } from './webmcp'

const tool = (name: string, open = vi.fn<(url: string) => void>()) => {
  const found = toolsFor('en', open).find((t) => t.name === name)
  if (!found) throw new Error(`no tool ${name}`)
  return found
}

const answer = (body: unknown, status = 200) =>
  vi.fn<() => Promise<Response>>(async () => new Response(JSON.stringify(body), { status }))

describe('WebMCP tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'modelContext')
  })

  it('get_pricing answers the prices the API confirms, in major units', async () => {
    const offer = {
      offer_id: 'off_1',
      schema_version: 1,
      checksum: 'x',
      published_at: 'now',
      ...projectPlans(),
    }
    vi.stubGlobal('fetch', answer({ data: offer }))
    const result = await tool('get_pricing').execute({})
    expect(result).toMatchObject({ plans: expect.any(Array) })
    const pro = projectPlans().plans.find((plan) => plan.id === 'pro')
    expect(JSON.stringify(result)).toContain(`"monthly":${(pro?.prices.CHF?.month ?? 0) / 100}`)
  })

  it.each([
    ['another offer', answer({ data: { offer_id: 'off_2', plans: [] } })],
    ['an error', answer({ error: 'down' }, 503)],
  ])('get_pricing refuses %s rather than guess a price', async (_, fetch) => {
    vi.stubGlobal('fetch', fetch)
    await expect(tool('get_pricing').execute({})).rejects.toThrow(/unavailable/)
  })

  it('open_page opens the page in the language, and only a known page', async () => {
    const open = vi.fn<(url: string) => void>()
    await expect(tool('open_page', open).execute({ page: 'pricing' })).resolves.toEqual({
      opened: '/pricing',
    })
    await expect(tool('open_page', open).execute({ page: 'https://evil.example' })).rejects.toThrow(
      /Unknown page/,
    )
    expect(open).toHaveBeenCalledExactlyOnceWith('/pricing')
    expect(pageUrl('security', 'de')).toBe('/de/sicherheit')
    expect(pageUrl('sign_up', 'de')).toMatch(/\/login\?lang=de$|\/de\/login$/)
  })

  it('every schema names its required parameters among its properties', () => {
    for (const t of toolsFor('en', vi.fn<(url: string) => void>())) {
      for (const name of t.inputSchema.required ?? [])
        expect(t.inputSchema.properties).toHaveProperty(name)
    }
  })

  it('registers the tools where the browser has WebMCP, and removes them on unmount', () => {
    const registered: string[] = []
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool: (t: WebMcpTool) => registered.push(t.name),
        unregisterTool: (name: string) => registered.splice(registered.indexOf(name), 1),
      },
    })
    const { unmount } = render(<WebMcp lang="en" />)
    expect(registered).toEqual(['get_pricing', 'open_page'])
    unmount()
    expect(registered).toEqual([])
  })

  it('does nothing without WebMCP', () => {
    expect(() => render(<WebMcp lang="en" />)).not.toThrow()
  })
})
