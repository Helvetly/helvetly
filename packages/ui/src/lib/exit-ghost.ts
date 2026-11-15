import { translate } from '@helvetly/ui/lib/i18n'
/**
 * Plays the exit animation of overlay elements (a drawer and its backdrop) that React removed while
 * they were still open. Drawers are mostly closed by unmounting them (a cleared `?id=`, a saved
 * form, a popped stack), which would cut them off mid-screen; this leaves an inert, hidden copy in
 * their place that animates out with the elements' own closed-state classes and then removes itself.
 *
 * Call it from a layout effect's cleanup, while the elements are still in the document. Elements
 * that are already closing (Radix animates those itself) are left alone, as are elements still in
 * the document a moment later (Strict Mode's rehearsal unmount). Without the Web Animations API
 * (jsdom) or with reduced motion, nothing is left behind, nor when `replaced()` says another
 * element took their place in the same commit.
 */
export function leaveExitGhost(
  elements: readonly (HTMLElement | null)[],
  replaced: () => boolean = () => false,
) {
  const open = elements.filter(
    (element): element is HTMLElement =>
      element !== null && element.isConnected && element.getAttribute('data-state') === 'open',
  )
  const first = open[0]
  if (!first || typeof first.getAnimations !== 'function') return
  if (window.matchMedia(translate('prefersReducedMotionReduce')).matches) return
  // Copied now, while scroll positions and canvases still have their content.
  const copies = open.map(snapshot)
  queueMicrotask(() => {
    if (replaced() || open.some((element) => element.isConnected)) return
    const ghost = document.createElement('div')
    ghost.dataset.slot = 'exit-ghost'
    ghost.setAttribute('aria-hidden', 'true')
    ghost.inert = true
    ghost.style.pointerEvents = 'none'
    ghost.append(...copies.map((copy) => copy.node))
    document.body.append(ghost)
    for (const copy of copies) {
      copy.restore()
      copy.node.setAttribute('data-state', 'closed')
      copy.node.removeAttribute('data-open')
      copy.node.setAttribute('data-closed', '')
    }
    const remove = () => ghost.remove()
    const running = copies.flatMap((copy) => copy.node.getAnimations().map((a) => a.finished))
    if (running.length === 0) return remove()
    void Promise.all(running).then(remove, remove)
    // A safety net: an animation that never finishes must not leave the copy on screen.
    window.setTimeout(remove, 1000)
  })
}

function snapshot(element: HTMLElement) {
  const node = element.cloneNode(true) as HTMLElement
  const from = [element, ...element.querySelectorAll('*')]
  const to = [node, ...node.querySelectorAll('*')]
  const scrolled = from.flatMap((source, index) =>
    source.scrollTop || source.scrollLeft
      ? [{ index, top: source.scrollTop, left: source.scrollLeft }]
      : [],
  )
  const canvases = from.flatMap((source, index) =>
    source instanceof HTMLCanvasElement ? [{ index, source }] : [],
  )
  return {
    node,
    // Scroll offsets only apply once the copy is in the document.
    restore() {
      for (const { index, top, left } of scrolled) {
        const target = to[index]
        if (target) target.scrollTo({ top, left, behavior: 'instant' })
      }
      for (const { index, source } of canvases) {
        const target = to[index]
        if (target instanceof HTMLCanvasElement) target.getContext('2d')?.drawImage(source, 0, 0)
      }
    },
  }
}
