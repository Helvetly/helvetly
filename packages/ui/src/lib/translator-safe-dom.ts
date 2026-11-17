/**
 * Browser translators (Chrome's Google Translate and others) move a page's text nodes into their own <font>
 * elements. React still holds the original nodes, so its next removeChild/insertBefore on them throws
 * ("not a child of this node") and the whole page falls to the error screen. Each call that would throw for that
 * reason instead acts on the child of `parent` that now holds the node (the translator's wrapper), so the page keeps
 * working and keeps its order. Calls that would not throw are untouched.
 */
function holderIn(parent: Node, node: Node): Node | null {
  let current: Node | null = node
  while (current && current.parentNode !== parent) current = current.parentNode
  return current
}

export function guardDomAgainstTranslators(proto: Node = Node.prototype) {
  const remove = proto.removeChild
  const insert = proto.insertBefore
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode === this) return remove.call(this, child) as T
    const holder = holderIn(this, child)
    if (holder) remove.call(this, holder)
    return child
  }
  proto.insertBefore = function <T extends Node>(this: Node, node: T, before: Node | null): T {
    if (!before || before.parentNode === this) return insert.call(this, node, before) as T
    return insert.call(this, node, holderIn(this, before)) as T
  }
}
