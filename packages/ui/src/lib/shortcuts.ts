/**
 * Keyboard shortcut keys as text: "mod+j" (⌘ on Apple devices, Ctrl elsewhere), "shift+d", "?" or a
 * sequence such as "g n" (G, then N). Letters are lowercase.
 */
export type Keys = string

type Combo = { key: string; mod: boolean; shift: boolean }

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

const MODIFIERS = new Set(['Shift', 'Meta', 'Control', 'Alt', 'AltGraph', 'CapsLock'])

function parseCombo(combo: string): Combo {
  const parts = combo.split('+')
  const key = parts.pop() ?? ''
  return { key, mod: parts.includes('mod'), shift: parts.includes('shift') }
}

export const parseKeys = (keys: Keys) => keys.split(' ').map(parseCombo)

function comboMatches(event: KeyEventLike, combo: Combo) {
  // Autofill (browser, password managers) fires keydown events without a key.
  if (!event.key || event.key.toLowerCase() !== combo.key) return false
  if (event.altKey || (event.metaKey || event.ctrlKey) !== combo.mod) return false
  // A symbol's Shift belongs to the keyboard layout ("?" is Shift+/ on most), so only letters check it.
  return !/^[a-z]$/.test(combo.key) || event.shiftKey === combo.shift
}

/**
 * A matcher for one shortcut's alternatives: true when a key event completes one of them. It remembers
 * how far a sequence got, which lapses after `timeout` milliseconds.
 */
export function createMatcher(alternatives: readonly Keys[], timeout = 1500) {
  const sequences = alternatives.map(parseKeys)
  const steps = sequences.map(() => 0)
  let last = 0
  return (event: KeyEventLike, now = Date.now()) => {
    if (MODIFIERS.has(event.key)) return false
    const stale = now - last > timeout
    last = now
    let hit = false
    sequences.forEach((sequence, index) => {
      const step = stale ? 0 : (steps[index] ?? 0)
      const expected = sequence[step]
      const first = sequence[0]
      const next =
        expected && comboMatches(event, expected)
          ? step + 1
          : first && comboMatches(event, first)
            ? 1
            : 0
      if (next === sequence.length) hit = true
      steps[index] = next === sequence.length ? 0 : next
    })
    if (hit) steps.fill(0)
    return hit
  }
}

/** Whether keys typed here belong to a text field, so single-key shortcuts must stay out of the way. */
export function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

/** Apple devices name the modifier ⌘; everything else uses Ctrl. */
export function isApple() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
}

/** Keys as the labels of the keycaps to press, one array per step of a sequence. */
export function keyLabels(keys: Keys, apple: boolean) {
  return parseKeys(keys).map(({ key, mod, shift }) => {
    const caps: string[] = []
    if (mod) caps.push(apple ? '⌘' : 'Ctrl')
    if (shift) caps.push(apple ? '⇧' : 'Shift')
    caps.push(key.toUpperCase())
    return caps
  })
}

/** The `aria-keyshortcuts` value for the alternatives a single press can trigger (sequences have none). */
export function ariaKeyShortcuts(alternatives: readonly Keys[], apple: boolean) {
  return alternatives
    .map(parseKeys)
    .filter((sequence) => sequence.length === 1)
    .map(([combo]) =>
      combo
        ? [
            ...(combo.mod ? [apple ? 'Meta' : 'Control'] : []),
            ...(combo.shift ? ['Shift'] : []),
            combo.key.length === 1 ? combo.key.toUpperCase() : combo.key,
          ].join('+')
        : '',
    )
    .join(' ')
}
