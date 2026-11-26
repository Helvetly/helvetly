import { accessibleScreens, bindScreenAction, captureScreen } from './screen-controls'

afterEach(() => {
  document.body.replaceChildren()
})

function addButton(main: HTMLElement, name: string) {
  const button = document.createElement('button')
  button.checkVisibility = () => true
  button.setAttribute('aria-label', name)
  main.append(button)
  return button
}

test('does not activate ambiguous, replaced or cross-record controls', () => {
  const main = document.createElement('main')
  document.body.append(main)
  const first = addButton(main, 'Save')
  const second = addButton(main, 'Save')
  const snapshot = captureScreen([])
  const action = {
    id: 'screen_action' as const,
    label: '',
    control: [...snapshot.controls.keys()][0]!,
  }
  expect(bindScreenAction(action, snapshot)).toBeUndefined()
  second.remove()
  const bound = bindScreenAction(action, captureScreen([]))
  expect(bound).toBeDefined()
  const duplicate = addButton(main, 'Save')
  expect(bound?.apply()).toBe(false)
  duplicate.remove()
  history.replaceState({}, '', '?id=another')
  expect(bound?.apply()).toBe(false)
  history.replaceState({}, '', '/')
  first.replaceWith(first.cloneNode(true))
  expect(bound?.apply()).toBe(false)
})

test('limits navigation to available pages and HR visibility', () => {
  const paths = accessibleScreens(['read:clients'], 'member', true)
  expect(paths).toContain('/clients')
  for (const path of ['/invoices', '/settings/approvals', '/employees', '/employees/payroll'])
    expect(paths).not.toContain(path)
  const screen = captureScreen(paths)
  expect(
    bindScreenAction({ id: 'screen_action', label: '', control: 'open.//other' }, screen),
  ).toBeUndefined()
  const nav = bindScreenAction({ id: 'screen_action', label: '', control: 'open./clients' }, screen)
  expect(nav?.href).toBe('/clients')
  expect(nav?.apply()).toBe(true)
  expect(nav?.apply()).toBe(false)
})

test('a portalled row menu binds to the record that opened it', () => {
  const main = document.createElement('main')
  main.innerHTML =
    '<table><tbody><tr><td>Ana</td><td><button id="actions">More</button></td></tr></tbody></table>'
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-labelledby', 'actions')
  menu.checkVisibility = () => true
  document.body.append(main, menu)
  addButton(menu, 'Delete')
  const snapshot = captureScreen([])
  const action = {
    id: 'screen_action' as const,
    label: '',
    control: [...snapshot.controls.keys()][0]!,
  }
  expect(bindScreenAction(action, snapshot)).toBeUndefined()
  expect(bindScreenAction({ ...action, row: 'Ben' }, snapshot)).toBeUndefined()
  const bound = bindScreenAction({ ...action, row: 'Ana' }, snapshot)
  expect(bound?.review).toContain('Ana')
  main.querySelector('td')!.textContent = 'Ben'
  expect(bound?.apply()).toBe(false)
})
