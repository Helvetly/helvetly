import { createTranslators, locale } from '@helvetly/i18n'

import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import it from '../messages/it.json'

export const translatorFor = createTranslators({ en, de, fr, it })
export const translate = translatorFor(locale)
