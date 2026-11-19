import { apiUrl, setApiBase } from '@helvetly/ui/lib/http'
import { afterEach, describe, expect, it } from 'vitest'

import { applyScope, scoped, slugOf, unscoped } from './scope'

describe('portal scope', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
    setApiBase('')
  })

  it('reads the slug from the address', () => {
    expect(slugOf('/w/acme/invoices/')).toBe('acme')
    expect(slugOf('/w/acme')).toBe('acme')
    expect(slugOf('/w/')).toBeNull()
    expect(slugOf('/login/')).toBeNull()
    expect(slugOf('/w/Acme/')).toBeNull()
    expect(slugOf('/wx/acme/')).toBeNull()
  })

  it('strips the prefix for matching routes', () => {
    expect(unscoped('/w/acme/invoices/')).toBe('/invoices/')
    expect(unscoped('/w/acme')).toBe('/')
    expect(unscoped('/quotes')).toBe('/quotes')
  })

  it('keeps links and API calls inside the scope', () => {
    window.history.replaceState(null, '', '/w/acme/login/')
    expect(scoped('/invoices')).toBe('/w/acme/invoices')
    applyScope()
    expect(apiUrl('/public/portal/session')).toBe('/w/acme/api/v1/public/portal/session')
  })

  it('changes nothing for the shared portal', () => {
    window.history.replaceState(null, '', '/login/')
    expect(scoped('/invoices')).toBe('/invoices')
    applyScope()
    expect(apiUrl('/public/portal/session')).toBe('/api/v1/public/portal/session')
  })
})
