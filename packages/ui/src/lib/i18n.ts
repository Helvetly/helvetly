import { createTranslators, locale } from '@helvetly/i18n'

import de from '../messages/de.json'
import en from '../messages/en.json'

export const translatorFor = createTranslators({ en, de })
export const translate = translatorFor(locale)
