import type { HeidiAction } from '@/lib/heidi'
import { messages } from '@/lib/i18n'
import { canReadPath } from '@/lib/permissions'

type ScreenAction = Extract<HeidiAction, { id: 'screen_action' }>

// Entry pages in the signed-in shell, without redirect, callback or record-specific URLs.
const pages = [
  '/',
  '/account',
  '/account/notifications',
  '/books',
  '/books/ledger',
  '/books/vat-return',
  '/clients',
  '/developers',
  '/documents',
  '/employees',
  '/employees/payroll',
  '/engagements',
  '/expenses',
  '/invoices',
  '/members',
  '/notifications',
  '/products',
  '/quotes',
  '/scheduling',
  '/settings/approvals',
  '/settings/audit-log',
  '/settings/billing',
  '/settings/billing/plans',
  '/settings/company',
  '/settings/documents',
  '/settings/emails',
  '/settings/employment',
  '/settings/invoices',
  '/settings/scheduling',
  '/settings/workspace',
]

export function accessibleScreens(scopes: readonly string[], role: string, hideEmployees: boolean) {
  return pages.filter(
    (path) =>
      canReadPath(scopes, path) &&
      !(path === '/settings/approvals' && !['owner', 'admin'].includes(role)) &&
      !(hideEmployees && (path.startsWith('/employees') || path === '/settings/employment')),
  )
}

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
const controlSelector =
  'button, [role=button], [role=switch], [role=tab], [role=menuitem], [role=checkbox], input, textarea, select'
const dialogSelector = '[role=dialog], [role=alertdialog], dialog[open], [role=menu]'
const displayed = (el: HTMLElement) =>
  !el.closest('[hidden], [inert], [aria-hidden=true], [data-heidi-panel]') &&
  el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === true
const neutralPage = (path: string) =>
  !/^\/(?:employees|developers|settings\/(?:employment|security)|account)(?:\/|$)/.test(path)
let labelKeys: Map<string, string> | undefined

function staticLabelKey(label: string) {
  if (!labelKeys) {
    labelKeys = new Map()
    // Only a key from the shipped interface is sent; customer names and field contents stay in this tab.
    for (const [key, value] of Object.entries(messages)) {
      if (!value.includes('{') && key.length <= 96 && !labelKeys.has(normalize(value)))
        labelKeys.set(normalize(value), key)
    }
  }
  return labelKeys.get(label)
}

function field(el: HTMLElement) {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  )
}

function labelOf(el: HTMLElement) {
  const labelled = el
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
  return normalize(
    el.getAttribute('aria-label') ||
      labelled ||
      (field(el)
        ? Array.from(el.labels ?? [], (l) => l.innerText).join(' ') ||
          el.getAttribute('placeholder') ||
          ''
        : el.innerText) ||
      '',
  )
}

function kindOf(el: HTMLElement) {
  if (
    el.matches(':disabled, [aria-disabled=true], [data-disabled], [readonly]') ||
    el.closest('[aria-disabled=true], [data-heidi-panel]') ||
    !displayed(el)
  )
    return
  if (el instanceof HTMLInputElement) {
    if (['checkbox', 'radio'].includes(el.type)) return 'click'
    if (!['text', 'number', 'search', 'email', 'tel', 'date', 'time', 'url'].includes(el.type))
      return
  }
  if (
    field(el) &&
    /password|passkey|secret|token|credential|one-time|cc-|card.?number|cvc|iban/i.test(
      [el.autocomplete, el.name, el.id, labelOf(el)].join(' '),
    )
  )
    return
  if (el instanceof HTMLSelectElement) return 'select'
  return field(el) ? 'fill' : 'click'
}

function surface() {
  const modal = [...document.querySelectorAll<HTMLElement>(dialogSelector)].findLast(displayed)
  return modal ?? document.querySelector<HTMLElement>('main')
}

const rowSelector = 'tr, [role=row]'

function rowOf(el: HTMLElement) {
  const menu = el.closest('[role=menu]')
  const trigger = menu?.getAttribute('aria-labelledby')
  return (
    el.closest(rowSelector) ??
    (trigger ? document.getElementById(trigger)?.closest(rowSelector) : null)
  )
}

function contextOf(el: HTMLElement) {
  const area = rowOf(el) ?? el.closest('[role=dialog], [role=alertdialog], dialog')
  return normalize(area?.textContent ?? '')
}

function selectedRows(root: HTMLElement | null) {
  return root
    ? [...root.querySelectorAll(rowSelector)]
        .filter(
          (row) =>
            row.matches('[aria-selected=true], [data-state=selected]') ||
            row.querySelector('input:checked, [role=checkbox][aria-checked=true]'),
        )
        .map((row) => normalize(row.textContent ?? ''))
        .join(' · ')
    : ''
}

function identifier(el: HTMLElement) {
  if (el.closest('[role=menu]') && !rowOf(el)) return
  const kind = kindOf(el)
  const label = kind && staticLabelKey(labelOf(el))
  return label ? kind + '.' + label : undefined
}

type Target = { node: WeakRef<HTMLElement>; context: string; label: string }

export type ScreenSnapshot = ReturnType<typeof captureScreen>

let screenEdits = 0
let observing = false

export function captureScreen(paths: readonly string[]) {
  // A selection or form edit changes which records a button would act on, even on the same URL.
  if (!observing) {
    observing = true
    const edit = (event: Event) => {
      if (
        event.target instanceof Element &&
        !event.target.closest('[data-heidi-panel]') &&
        event.target.closest('main, ' + dialogSelector)
      )
        screenEdits++
    }
    for (const type of ['click', 'input', 'change']) document.addEventListener(type, edit, true)
  }
  const url = location.href
  const root = surface()
  const controls = new Map<string, Target[]>()
  const navigation = paths.filter((path) => pages.includes(path)).map((path) => 'open.' + path)
  if (root && neutralPage(location.pathname)) {
    for (const el of root.querySelectorAll<HTMLElement>(controlSelector)) {
      const id = identifier(el)
      if (!id) continue
      const label = labelOf(el)
      if (!controls.has(id) && controls.size + navigation.length >= 128) continue
      const targets = controls.get(id) ?? []
      targets.push({ node: new WeakRef(el), label, context: contextOf(el) })
      controls.set(id, targets)
    }
  }
  return {
    url,
    edits: screenEdits,
    selected: selectedRows(root),
    root: root ? new WeakRef(root) : null,
    navigation,
    controls,
    expires: Date.now() + 5 * 60_000,
  }
}

function resolve(action: ScreenAction, snapshot: ScreenSnapshot) {
  const root = surface()
  if (
    Date.now() >= snapshot.expires ||
    location.href !== snapshot.url ||
    snapshot.edits !== screenEdits ||
    !root ||
    root !== snapshot.root?.deref()
  )
    return
  if (selectedRows(root) !== snapshot.selected) return
  const matching = [...root.querySelectorAll<HTMLElement>(controlSelector)].filter((el) => {
    if (identifier(el) !== action.control) return false
    const row = rowOf(el)
    if (!row) return !action.row
    return (
      action.row &&
      [...row.querySelectorAll('td, [role=cell], th')].some(
        (cell) => normalize(cell.textContent ?? '') === action.row,
      )
    )
  })
  if (matching.length !== 1) return
  const el = matching[0]!
  return snapshot.controls
    .get(action.control)
    ?.some(
      (target) =>
        target.node.deref() === el &&
        target.label === labelOf(el) &&
        target.context === contextOf(el),
    )
    ? el
    : undefined
}

export type BoundScreenAction = {
  label: string
  review: string
  href?: string
  apply: () => boolean
}

/** Bound only to the originating turn, record and live element; stored messages never restore an activation. */
export function bindScreenAction(
  action: ScreenAction,
  snapshot: ScreenSnapshot,
): BoundScreenAction | undefined {
  let used = false
  if (action.control.startsWith('open.')) {
    const path = action.control.slice(5)
    if (!snapshot.navigation.includes(action.control) || !pages.includes(path)) return
    return {
      href: path,
      label: path,
      review: path,
      apply: () => {
        if (used || Date.now() >= snapshot.expires || location.href !== snapshot.url) return false
        used = true
        return true
      },
    }
  }
  // Only the chosen controls survive into the live answer.
  snapshot = {
    ...snapshot,
    controls: new Map([[action.control, snapshot.controls.get(action.control) ?? []]]),
  }
  const initial = resolve(action, snapshot)
  if (!initial) return
  const label = labelOf(initial)
  const initialValue = field(initial) ? initial.value : null
  const dialog = initial.closest<HTMLElement>('[role=dialog], [role=alertdialog], dialog')
  const title =
    dialog && (dialog.getAttribute('aria-label') || dialog.querySelector('h1,h2,h3')?.textContent)
  const review = [
    new URL(snapshot.url).pathname,
    title,
    action.row || snapshot.selected,
    label,
    action.value,
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    label,
    review,
    apply: () => {
      const el = resolve(action, snapshot)
      if (used || !el || el !== initial || (field(el) && el.value !== initialValue)) return false
      used = true
      if (action.control.startsWith('click.')) {
        el.click()
        return true
      }
      if (!field(el)) return false
      const value = action.value ?? ''
      if (el instanceof HTMLSelectElement) {
        const options = [...el.options].filter((o) => !o.disabled && normalize(o.label) === value)
        if (options.length !== 1) return false
        el.value = options[0]!.value
        el.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        const proto =
          el instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return true
    },
  }
}
