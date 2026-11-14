import { learn, learnValues, parseHabits, preferred, withHabits, type Habits } from './habits'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 10, 8)

const picked = (key: string, values: string[], at = now) =>
  values.reduce<Habits>((habits, value) => learn(habits, key, value, at), {})

test('one odd choice is not a habit yet; two are', () => {
  expect(preferred(picked('f.x', ['a']), 'f.x', now)).toBeNull()
  expect(preferred(picked('f.x', ['a', 'a']), 'f.x', now)).toBe('a')
})

test('the value picked most wins', () => {
  expect(preferred(picked('f.x', ['a', 'b', 'b', 'a', 'b']), 'f.x', now)).toBe('b')
})

test('recent choices outweigh old ones', () => {
  const old = picked('f.x', ['a', 'a', 'a'], now - 365 * DAY)
  const habits = ['b', 'b'].reduce((h, v) => learn(h, 'f.x', v, now), old)
  expect(preferred(habits, 'f.x', now)).toBe('b')
})

test('habits fade when not used', () => {
  expect(preferred(picked('f.x', ['a', 'a'], now - 120 * DAY), 'f.x', now)).toBeNull()
})

test('malformed storage starts over', () => {
  expect(parseHabits('not json')).toEqual({})
  expect(parseHabits('[1]')).toEqual({})
  expect(parseHabits('{"f.x":{"a":{"s":"2","at":1}},"f.y":{"b":{"s":2,"at":1}}}')).toEqual({
    'f.y': { b: { s: 2, at: 1 } },
  })
})

type Values = { kind: string; company: boolean; name: string; rate: string }
const base: Values = { kind: 'service', company: true, name: '', rate: '8.1' }

test('a form starts with its habits, client first, and keeps what settings fixed', () => {
  let habits: Habits = {}
  for (let i = 0; i < 2; i++) {
    habits = learnValues(
      habits,
      'p',
      { ...base, kind: 'product', company: false, rate: '0' },
      ['kind', 'company', 'rate'],
      null,
      now,
    )
    habits = learnValues(habits, 'p', { ...base, kind: 'subscription' }, ['kind'], 'cli_1', now)
  }
  expect(
    withHabits(base, habits, 'p', ['kind', 'company', 'rate'], { fixed: ['rate'] }, now),
  ).toEqual({
    ...base,
    kind: 'product',
    company: false,
  })
  expect(withHabits(base, habits, 'p', ['kind'], { scope: 'cli_1' }, now).kind).toBe('subscription')
  expect(withHabits(base, habits, 'p', ['kind'], { scope: 'cli_2' }, now).kind).toBe('product')
})

test('a habit for an option the form no longer offers is ignored', () => {
  const habits = picked('p.kind', ['retired', 'retired'])
  const options = { allowed: { kind: (value: string) => value !== 'retired' } }
  expect(withHabits(base, habits, 'p', ['kind'], options, now).kind).toBe('service')
})

test('empty values are not learned', () => {
  expect(learnValues({}, 'p', base, ['name'], null, now)).toEqual({})
})
