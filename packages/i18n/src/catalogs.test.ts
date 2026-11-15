import { describe, expect, it } from 'vitest'

import platform from '../../../apps/platform/src/messages/en.json'
import portal from '../../../apps/portal/src/messages/en.json'
import web from '../../../apps/web/src/messages/en.json'
import ui from '../../ui/src/messages/en.json'
import { createTranslator } from './index'

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
