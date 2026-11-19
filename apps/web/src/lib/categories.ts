import type { Locale } from '@helvetly/i18n'

import { perLanguage } from '@/lib/i18n'

const categoriesIn = perLanguage((translate): Record<string, string> => ({
  'Account and security': translate('category1'),
  'Choosing software': translate('category14'),
  Clients: translate('category2'),
  'Documents and signatures': translate('category3'),
  'E-invoicing': translate('category4'),
  Engagements: translate('category5'),
  Expenses: translate('category6'),
  'Getting paid': translate('category7'),
  'Getting started': translate('category8'),
  Heidi: translate('category9'),
  'Invoices and getting paid': translate('category10'),
  'Team and workspace': translate('category11'),
  VAT: translate('category12'),
  'VAT and books': translate('category13'),
}))

export const categoryLabel = (category: string, language: Locale) =>
  categoriesIn(language)[category] ?? category
