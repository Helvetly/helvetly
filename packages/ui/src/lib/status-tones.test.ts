import { describe, expect, it } from 'vitest'

import { STATUS_TONES } from './status-tones'

describe('STATUS_TONES', () => {
  it('reads every refusal as red, and an expired quote as over', () => {
    expect(STATUS_TONES.quote.declined).toBe('red')
    expect(STATUS_TONES.quote.expired).toBe('neutral')
    expect(STATUS_TONES.signatureRequest.declined).toBe('red')
    expect(STATUS_TONES.approval.rejected).toBe('red')
    expect(STATUS_TONES.word.rejected).toBe('red')
  })
})
