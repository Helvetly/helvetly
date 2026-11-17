// The Employees module is on Business only: its stories run on a Business workspace unless they show the lock.
import { http, HttpResponse, type RequestHandler } from 'msw'

import { billingFixture } from '@/components/billing/billing-fixture'
import type { PlanId } from '@/lib/billing'

import { pageParameters } from './frame'

/** `records: false` is a workspace that never had employees: on a plan without the module it hides it entirely. */
export const billingOn = (plan: PlanId, records = true) =>
  http.get('/api/v1/billing', () =>
    HttpResponse.json({
      data: billingFixture({
        plan,
        status: 'active',
        interval: 'month',
        pricing: 'per_seat',
        locked: false,
        has_customer: true,
        has_employees: records,
        current_period_end: '2026-12-01',
      }),
    }),
  )

/** `pageParameters` on Business; a story's own handlers come first, so `billingOn('pro')` shows the lock. */
export const hrPage = (
  pathname: string,
  query: Record<string, string> = {},
  handlers: RequestHandler[] = [],
) => pageParameters(pathname, query, [...handlers, billingOn('business')])
