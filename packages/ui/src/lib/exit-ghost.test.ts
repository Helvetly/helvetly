import { afterEach, describe, expect, it, vi } from 'vitest'

import { leaveExitGhost } from './exit-ghost'

describe('leaveExitGhost', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
    document.body.innerHTML = ''
  })

  it('keeps each sliding copy at its end until the slowest one is done', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { promise: finished, resolve: finish } = Promise.withResolvers<void>()
    // jsdom has no Web Animations API: every element reports one running animation.
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: () => [{ finished }],
    })
    const sheet = document.createElement('div')
    sheet.setAttribute('data-state', 'open')
    document.body.append(sheet)

    leaveExitGhost([sheet])
    sheet.remove()
    await Promise.resolve()

    const copy = document.querySelector<HTMLElement>('[data-slot="exit-ghost"] > div')
    expect(copy?.getAttribute('data-state')).toBe('closed')
    // A copy that finished first must not snap back into place while another still runs.
    expect(copy?.style.animationFillMode).toBe('forwards')
    finish()
    await finished
    await Promise.resolve()
    expect(document.querySelector('[data-slot="exit-ghost"]')).toBeNull()
  })
})
