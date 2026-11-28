import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const html = readFileSync(new URL('../apps/api/internal/auth/ads.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
const site = 'https://www.helvetly.com'
const app = 'https://app.helvetly.com'
const id = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function frame(consent = 'yes') {
  const parent = { postMessage: (message, origin) => acknowledgements.push({ ...message, origin }) }
  const acknowledgements = []
  const loaders = []
  const listeners = new Map()
  const window = {
    parent,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
  }
  const document = {
    cookie: 'helvetly_ads=' + consent,
    createElement: () => ({}),
    head: { append: (node) => loaders.push(node) },
  }
  runInNewContext(script, { window, document })
  return {
    document,
    loaders,
    acknowledgements,
    send(origin, data, source = parent) {
      listeners.get('message')?.({ origin, source, data })
    },
    events: () =>
      (window.dataLayer ?? []).map((args) => [...args]).filter((args) => args[0] === 'event'),
  }
}

test('only consented, server-marked registrations from the platform send the exact Ads action once', () => {
  const f = frame()
  f.send(site, { type: 'signup', id })
  f.send('https://unknown.example', { type: 'signup', id })
  f.send(app, { type: 'signup', id }, {})
  f.send(app, { type: 'signup', id: 'someone@example.com' })
  assert.equal(f.loaders.length, 0)
  f.send(app, { type: 'signup', id })
  f.send(app, { type: 'signup', id })
  assert.equal(f.loaders.length, 1)
  f.loaders[0].onload()
  assert.equal(f.events().length, 1)
  const [command, type, fields] = f.events()[0]
  assert.equal(command, 'event')
  assert.equal(type, 'conversion')
  const { event_callback, ...payload } = fields
  assert.deepEqual(payload, {
    send_to: 'AW-18597239844/j6ZeCP7liMAdEKS47aNF',
    value: 1,
    currency: 'CHF',
    transaction_id: id,
  })
  event_callback()
  assert.deepEqual(f.acknowledgements, [{ type: 'signup-sent', id, origin: app }])
})

test('landing clicks never emit a registration and withdrawing consent before load suppresses the event', () => {
  const refused = frame('no')
  refused.send(site, { type: 'landing' })
  refused.send(app, { type: 'signup', id })
  assert.equal(refused.loaders.length, 0)
  const f = frame()
  f.send(site, { type: 'landing' })
  f.loaders[0].onload()
  assert.equal(f.events().length, 0)
  const withdrawn = frame()
  withdrawn.send(app, { type: 'signup', id })
  withdrawn.document.cookie = 'helvetly_ads=no'
  withdrawn.loaders[0].onload()
  assert.equal(withdrawn.events().length, 0)
})
