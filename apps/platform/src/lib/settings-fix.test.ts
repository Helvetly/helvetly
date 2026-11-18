import { describe, expect, it } from 'vitest'

import { settingsFix } from './invoices'

describe('settingsFix', () => {
  it('opens company fields on Settings → Company and the e-invoice address on Invoices', () => {
    expect(settingsFix('seller.zip').href).toBe('/settings/company?focus=seller.zip#company')
    expect(settingsFix('iban').href).toBe('/settings/company?focus=iban#bank')
    expect(settingsFix('seller.electronic_address').href).toBe(
      '/settings/invoices?focus=seller.electronic_address#einvoice',
    )
  })
})
