import { createTranslators, locale } from '@helvetly/i18n'

import cs from '../messages/cs.json'
import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import it from '../messages/it.json'
import nl from '../messages/nl.json'
import sv from '../messages/sv.json'

export const translatorFor = createTranslators({ en, de, fr, it, nl, cs, sv })
export const translate = translatorFor(locale)
