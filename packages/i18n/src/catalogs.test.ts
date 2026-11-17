import { IntlMessageFormat } from 'intl-messageformat'
import { describe, expect, it } from 'vitest'

import platformDE from '../../../apps/platform/src/messages/de.json'
import platform from '../../../apps/platform/src/messages/en.json'
import platformFR from '../../../apps/platform/src/messages/fr.json'
import platformIT from '../../../apps/platform/src/messages/it.json'
import portalDE from '../../../apps/portal/src/messages/de.json'
import portal from '../../../apps/portal/src/messages/en.json'
import portalFR from '../../../apps/portal/src/messages/fr.json'
import portalIT from '../../../apps/portal/src/messages/it.json'
import web from '../../../apps/web/src/messages/en.json'
import ui from '../../ui/src/messages/en.json'
import { createTranslator } from './index'

function argumentsIn(elements: ReturnType<IntlMessageFormat['getAst']>): string[] {
  return elements.flatMap((element) => {
    if (element.type === 0 || element.type === 7) return []
    if ('options' in element)
      return [
        element.value,
        ...Object.values(element.options).flatMap((option) => argumentsIn(option.value)),
      ]
    if ('children' in element) return [element.value, ...argumentsIn(element.children)]
    return [element.value]
  })
}

const parameters = (message: string) =>
  argumentsIn(
    new IntlMessageFormat(message, 'en', undefined, { ignoreTag: true }).getAst(),
  ).toSorted()

describe('English catalogs', () => {
  for (const [app, catalog] of Object.entries({ platform, portal, web, ui })) {
    it(`${app}: every message is valid ICU and accepts its placeholders`, () => {
      const translate = createTranslator<Record<string, string>>(catalog, 'en')
      for (const [key, message] of Object.entries(catalog)) {
        const values = Object.fromEntries(
          [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)[,}]/g)].map((match) => [match[1], 2]),
        )
        expect(() => translate(key, values)).not.toThrow()
      }
    })
  }
})

describe.each([
  ['platform', platform, { de: platformDE, fr: platformFR, it: platformIT }],
  ['portal', portal, { de: portalDE, fr: portalFR, it: portalIT }],
] as const)('%s translations', (_app, english, catalogs) => {
  for (const [language, catalog] of Object.entries(catalogs)) {
    it(`${language}: covers every message with the same ICU arguments`, () => {
      const translated = new Map<string, string>(Object.entries(catalog))
      expect([...translated.keys()].toSorted()).toEqual(Object.keys(english).toSorted())
      const translate = createTranslator<Record<string, string>>(english, language, catalog)

      for (const [key, source] of Object.entries(english)) {
        const message = translated.get(key) ?? ''
        expect({ key, empty: message.trim() === '' }).toEqual({ key, empty: source.trim() === '' })
        expect({ key, values: parameters(message) }).toEqual({ key, values: parameters(source) })
        expect({ key, start: message.match(/^\s*/)?.[0], end: message.match(/\s*$/)?.[0] }).toEqual(
          {
            key,
            start: source.match(/^\s*/)?.[0],
            end: source.match(/\s*$/)?.[0],
          },
        )

        for (const count of [0, 1, 2]) {
          const values = Object.fromEntries(parameters(source).map((name) => [name, count]))
          expect(() =>
            translate(key, { ...values, scope: 'workspace', monthly: 'true' }),
          ).not.toThrow()
          expect(() =>
            translate(key, { ...values, scope: 'member', monthly: 'false' }),
          ).not.toThrow()
        }
      }
    })
  }
})
