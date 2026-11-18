/** Scrolled to the far end: nothing more lies past that edge. */
const atEnd = (scroll: number, client: number, size: number) => scroll + client >= size - 1

/**
 * The first ancestor whose overflow would cut off a focus ring of `ring` px around `element`
 * (`ring-3`), or null when the whole ring shows. `overflow-clip-margin` counts as room.
 * shortcut: only fixed boxes end the walk (absolute ones are treated as in flow); enough for drawers and dialogs.
 */
export function ringClipper(element: Element, ring = 3): Element | null {
  const box = element.getBoundingClientRect()
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    // A fixed box (a sheet, a dialog) is clipped only by itself, never by what is around it.
    const last = style.position === 'fixed'
    if (style.overflowX === 'visible' && style.overflowY === 'visible') {
      if (last) break
      continue
    }
    const margin = style.overflowX === 'clip' ? Number.parseFloat(style.overflowClipMargin) || 0 : 0
    const clip = node.getBoundingClientRect()
    // Scrolled partly out of view is not a cut-off ring: focusing it scrolls it in.
    if (
      box.left < clip.left ||
      box.right > clip.right ||
      box.top < clip.top ||
      box.bottom > clip.bottom
    )
      return null
    const room = ring - margin
    // An edge the box can still scroll past is a scroll position, not a cut-off: focusing scrolls the ring in.
    if (
      (box.left - room < clip.left && node.scrollLeft <= 0) ||
      (box.right + room > clip.right &&
        atEnd(node.scrollLeft, node.clientWidth, node.scrollWidth)) ||
      (box.top - room < clip.top && node.scrollTop <= 0) ||
      (box.bottom + room > clip.bottom &&
        atEnd(node.scrollTop, node.clientHeight, node.scrollHeight))
    )
      return node
    if (last) break
  }
  return null
}

// Controls that draw a focus ring: a borderless field inside a card (Heidi's composer) has none to clip.
const RINGED = /\bfocus(-visible)?:ring/

/** Every visible control in `root` whose focus ring an ancestor would cut off, described for a failure message. */
export function clippedRings(root: ParentNode): string[] {
  const controls = root.querySelectorAll<HTMLElement>(
    'input, textarea, select, button, [role=combobox], [role=switch], [role=checkbox]',
  )
  return [...controls].flatMap((control) => {
    if (!RINGED.test(control.className) || !control.checkVisibility()) return []
    const clipper = ringClipper(control)
    if (!clipper) return []
    const name = control.getAttribute('aria-label') ?? control.textContent?.trim() ?? control.id
    return [
      `${control.tagName.toLowerCase()} "${name.slice(0, 40)}" in ${clipper.tagName.toLowerCase()}.${String(clipper.className).slice(0, 80)}`,
    ]
  })
}
