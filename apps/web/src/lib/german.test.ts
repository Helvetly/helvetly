import { createTranslator } from '@helvetly/i18n'
import { describe, expect, it } from 'vitest'

import de from '../messages/de.json'
import en from '../messages/en.json'

const parameters = (value: string) => value.match(/\{\w+\}/g)?.toSorted() ?? []

describe('German marketing catalog', () => {
  it('covers every English message and preserves its interpolation values', () => {
    expect(Object.keys(de).toSorted()).toEqual(Object.keys(en).toSorted())
    const german = createTranslator<Record<string, string>>(en, 'de-CH', de)
    const translated = new Map(Object.entries(de))
    for (const [key, source] of Object.entries(en)) {
      const message = translated.get(key) ?? ''
      expect({ key, values: parameters(message) }).toEqual({ key, values: parameters(source) })
      expect(message).not.toMatch(/ZX[QV]\d|[ßẞ]/)
      const values = Object.fromEntries(
        [...source.matchAll(/\{(\w+)\}/g)].map((match) => [match[1], 3]),
      )
      expect(() => german(key, values)).not.toThrow()
    }
  })
})
