import { createMessages, locale } from '@helvetly/i18n'

import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import it from '../messages/it.json'

const catalogs = { en, de, fr, it }
export const messages =
  locale === 'de' || locale === 'fr' || locale === 'it' ? catalogs[locale] : en
export const translate = createMessages(catalogs)
