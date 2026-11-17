import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { expect, test } from 'vitest'

import { guardDomAgainstTranslators } from './translator-safe-dom'

/** What Chrome's translator does: each text node moves into a <font> that replaces it. */
function translate(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) if (walker.currentNode instanceof Text) texts.push(walker.currentNode)
  for (const text of texts) {
    const font = document.createElement('font')
    text.replaceWith(font)
    font.append(text)
    text.data = `[fr] ${text.data}`
  }
}

function Page() {
  const [open, setOpen] = useState(true)
  return (
    <p>
      {open && 'First'}
      {open ? 'Second' : null}
      <span>Last</span>
      <button type="button" aria-label="Toggle" onClick={() => setOpen((value) => !value)} />
    </p>
  )
}

const run = () => {
  const { container } = render(<Page />)
  translate(container)
  const button = container.querySelector('button')
  if (!button) throw new Error('No toggle')
  act(() => button.click())
  act(() => button.click())
  return container
}

test('without the guard, a translated page breaks when React updates it', () => {
  // React reports the DOM errors together and unmounts the tree: the error screen in the app.
  let failure: unknown
  try {
    run()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(AggregateError)
  const names =
    failure instanceof AggregateError
      ? failure.errors.map((error: unknown) =>
          // jsdom's DOMException is not an Error of this realm.
          typeof error === 'object' && error !== null && 'name' in error ? error.name : null,
        )
      : []
  expect(names).toContain('NotFoundError')
})

test('with the guard, React removes and re-inserts translated text in order', () => {
  guardDomAgainstTranslators()
  const container = run()
  expect(container.textContent).toBe('FirstSecond[fr] Last')
})
