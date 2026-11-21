import { createTranslator, localeDetails } from '@helvetly/i18n'
import { describe, expect, it } from 'vitest'

import cs from '../messages/cs.json'
import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import itCatalog from '../messages/it.json'
import nl from '../messages/nl.json'
import sv from '../messages/sv.json'
import { translatorFor } from './i18n'

// A plural branch's text ("one {Kunde}") is wording, not a parameter.
const parameters = (value: string) =>
  [...value.matchAll(/(?<!(?:zero|one|two|few|many|other|=\d+)\s*)\{(\w+)(?:\}|,)/g)]
    .map((match) => match[1])
    .toSorted()

describe.each([
  ['de', de],
  ['fr', fr],
  ['it', itCatalog],
  ['nl', nl],
  ['cs', cs],
  ['sv', sv],
] as const)('%s shared controls catalog', (language, catalog) => {
  it('covers every English message with valid ICU and the same values', () => {
    const translated = new Map<string, string>(Object.entries(catalog))
    expect([...translated.keys()].toSorted()).toEqual(Object.keys(en).toSorted())
    const translate = createTranslator<Record<string, string>>(
      en,
      localeDetails(language).languageTag,
      Object.fromEntries(translated),
    )
    for (const [key, source] of Object.entries(en)) {
      expect({ key, values: parameters(translated.get(key) ?? '') }).toEqual({
        key,
        values: parameters(source),
      })
      const values = Object.fromEntries(parameters(source).map((name) => [name, 3]))
      expect(() => translate(key, values)).not.toThrow()
    }
  })

  it('words the language switcher in the language', () => {
    expect(translatorFor(language)('changeLanguage')).not.toBe(en.changeLanguage)
    expect(translatorFor(language)('language')).not.toBe(en.language)
  })
})
