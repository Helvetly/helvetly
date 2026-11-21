// A <button> without a type submits the form it sits in: "+ Add line" once saved and closed the quote editor.

const tick = () => new Promise((resolve) => setTimeout(resolve, 50))

const describe = (button: HTMLButtonElement) =>
  button.getAttribute('aria-label') ||
  button.labels?.[0]?.textContent?.trim() ||
  button.textContent?.trim() ||
  button.outerHTML.slice(0, 120)

/** Fails when a button inside a form leaves its type to the browser's default ("submit"). */
export function expectTypedFormButtons(root: ParentNode = document) {
  const untyped = [...root.querySelectorAll<HTMLButtonElement>('form button:not([type])')]
  if (untyped.length > 0)
    throw new Error(
      `A button inside a form has no type (it would submit the form); give it type="button" or type="submit":\n${untyped.map(describe).join('\n')}`,
    )
}

// Layers a click can open on top of the form: menus, popovers, pickers and dialogs.
const layers = () =>
  document.querySelectorAll(
    '[role="menu"], [role="dialog"], [role="alertdialog"], [data-slot="popover-content"]',
  ).length

/**
 * Clicks every enabled non-submit button inside the forms under `root` and fails when one of them submitted its form.
 * The submit is stopped before React sees it, so nothing is saved while the buttons are tried; a menu, picker or
 * dialog a click opens is closed again with Escape. `skip` names buttons that leave or save on purpose
 * (Cancel, Close, a second save button such as Save draft).
 */
export async function expectButtonsDoNotSubmit(
  root: ParentNode = document,
  { skip }: { skip?: RegExp } = {},
) {
  const submitted: string[] = []
  let current = ''
  const stop = (event: Event) => {
    submitted.push(current)
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  window.addEventListener('submit', stop, true)
  try {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('form button')].filter(
      // The attribute, not .type: a button without one reports "submit" and is exactly what must be tried.
      (button) => button.getAttribute('type') !== 'submit' && !skip?.test(describe(button)),
    )
    if (buttons.length === 0) throw new Error('No non-submit button inside a form to try')
    // One after another: each click must settle (and what it opened close) before the next.
    const tryInTurn = async ([button, ...rest]: HTMLButtonElement[]): Promise<void> => {
      if (!button) return
      // A click before may have removed it (a deleted line) or disabled it.
      if (button.isConnected && !button.disabled) {
        current = describe(button)
        const open = layers()
        button.click()
        await tick()
        if (layers() > open) {
          document.activeElement?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
          )
          await tick()
        }
      }
      await tryInTurn(rest)
    }
    await tryInTurn(buttons)
  } finally {
    window.removeEventListener('submit', stop, true)
  }
  if (submitted.length > 0)
    throw new Error(`These buttons submitted their form:\n${submitted.join('\n')}`)
}
