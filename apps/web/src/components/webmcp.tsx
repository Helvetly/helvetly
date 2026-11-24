'use client'

import { defaultLocale, languageHref, type Locale } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'
import { useEffect } from 'react'

import { confirms, OFFER_URL, projectPlans, type PublicOfferValues } from '@/lib/offer'
import { PLATFORM_URL } from '@/lib/site'

/** A WebMCP tool (https://github.com/webmachinelearning/webmcp): what an AI agent in the browser can call here. */
export type WebMcpTool = {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  annotations?: { readOnlyHint?: boolean }
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

type ModelContext = {
  registerTool: (tool: WebMcpTool) => unknown
  unregisterTool?: (name: string) => void
}

/** The pages an agent can open, by name: the site's sections and the sign-up. */
export const PAGES = [
  'home',
  'pricing',
  'compare_plans',
  'security',
  'guides',
  'help',
  'faq',
  'sign_up',
] as const
type PageName = (typeof PAGES)[number]

const isPage = (value: unknown): value is PageName => PAGES.some((page) => page === value)

const PATHS: Record<Exclude<PageName, 'sign_up'>, string> = {
  home: '/',
  pricing: '/pricing',
  compare_plans: '/pricing#compare-plans',
  security: '/security',
  guides: '/guides',
  help: '/help',
  faq: '/faq',
}

export function pageUrl(page: PageName, lang: Locale): string {
  if (page === 'sign_up') {
    // Sign-in is passwordless and makes the account on first use (lib/site.ts).
    return `${PLATFORM_URL}${lang === defaultLocale ? '/login' : languageHref('/login', lang)}`
  }
  return publicHref(PATHS[page], lang)
}

/** Prices in major units, per person and month, tax included, for each plan and currency. */
export function pricing(offer: PublicOfferValues) {
  return {
    price_per: 'person and month, tax included',
    trial: 'Every new workspace starts with a free 7-day Pro trial.',
    plans: offer.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      prices: Object.fromEntries(
        Object.entries(plan.prices).map(([currency, price]) => [
          currency,
          { monthly: price.month / 100, billed_yearly_per_month: price.year / 100 / 12 },
        ]),
      ),
    })),
  }
}

export function toolsFor(lang: Locale, open: (url: string) => void): WebMcpTool[] {
  return [
    {
      name: 'get_pricing',
      description:
        "Helvetly's current plans (Basic, Pro, Business) and their prices per person and month in CHF, EUR and " +
        'USD, monthly or billed yearly, tax included.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        // The same check as the pricing page: only prices the API confirms it charges.
        const response = await fetch(OFFER_URL, { cache: 'no-cache' })
        if (!response.ok || !confirms(await response.json())) {
          throw new Error('The current prices are unavailable; see the pricing page.')
        }
        return pricing(projectPlans())
      },
    },
    {
      name: 'open_page',
      description:
        "Opens a page of Helvetly's website in this language: home, pricing, compare_plans, security (data " +
        'protection and EU hosting), guides (back-office software, Swiss VAT, QR bill, e-invoicing), help, faq, or sign_up ' +
        '(start the free trial; sign-in is passwordless).',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'string', enum: [...PAGES], description: 'The page to open.' },
        },
        required: ['page'],
      },
      execute: async ({ page }) => {
        if (!isPage(page)) throw new Error(`Unknown page: ${String(page)}.`)
        const url = pageUrl(page, lang)
        open(url)
        return { opened: url }
      },
    },
  ]
}

const isModelContext = (value: unknown): value is ModelContext =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'registerTool') === 'function'

/** The browser's WebMCP entry point, where it has one: document.modelContext, or navigator's in early builds. */
function modelContext(): ModelContext | undefined {
  return [Reflect.get(document, 'modelContext'), Reflect.get(navigator, 'modelContext')].find(
    isModelContext,
  )
}

/** Registers the website's WebMCP tools for AI agents; nothing where the browser has no WebMCP. */
export function WebMcp({ lang }: { lang: Locale }) {
  useEffect(() => {
    const context = modelContext()
    if (!context) return
    const tools = toolsFor(lang, (url) => window.location.assign(url))
    for (const tool of tools) context.registerTool(tool)
    return () => {
      for (const tool of tools) context.unregisterTool?.(tool.name)
    }
  }, [lang])

  return null
}
