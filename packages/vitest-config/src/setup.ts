import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach } from 'vitest'

import { expectQuietConsole, guardConsole } from './console-guard'

guardConsole()

// Unmounting can still log (a late state update, an effect's cleanup), so the console is checked after it.
afterEach(() => {
  cleanup()
  expectQuietConsole()
})
// What lands after a file's last test (a request still in flight) fails the file.
afterAll(expectQuietConsole)

// jsdom has no matchMedia; sonner and the sidebar's useIsMobile read it. Nothing ever matches.
window.matchMedia ??= (query: string) => {
  const list: MediaQueryList = Object.assign(new EventTarget(), {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  })
  return list
}

// jsdom does no layout, so it has no scrollIntoView; nothing to scroll in tests.
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.scrollTo ??= () => {}

// jsdom has no ResizeObserver; cmdk (the command lists in pickers) observes its list's size.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
