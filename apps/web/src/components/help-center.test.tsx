import { isLocale, locales, type Locale } from '@helvetly/i18n'
import { LanguageProvider } from '@helvetly/ui/components/language-provider'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { readCollection } from '@/lib/content'
import { translatorFor } from '@/lib/i18n'

import { HELP_QUICK, HelpCenter, matchingHelp } from './help-center'

const entriesIn = (language: Locale) =>
  readCollection('help', language).map(({ slug, title, description, category }) => ({
    slug,
    title,
    description,
    category,
  }))

const languages = Object.keys(locales).filter(isLocale)

describe.each(languages)('help center suggestions in %s', (language) => {
  it.each(HELP_QUICK)('%s finds a translated article', (key) => {
    const suggestion = translatorFor(language)(key)
    expect(matchingHelp(entriesIn(language), suggestion).map((e) => e.slug)).not.toEqual([])
  })
})

describe('help center search', () => {
  it('searches a suggestion when clicked, clears it and says when nothing matches', async () => {
    const translate = translatorFor('fr')
    render(
      <LanguageProvider language="fr">
        <HelpCenter entries={entriesIn('fr')} />
      </LanguageProvider>,
    )
    const box = screen.getByRole('searchbox')
    const suggestion = translate('helpQuickPasskey')

    await userEvent.click(screen.getByRole('button', { name: suggestion }))
    expect(box).toHaveProperty('value', suggestion)
    expect(screen.queryByText(translate('nothingMatches', { query: suggestion }))).toBeNull()
    const found = matchingHelp(entriesIn('fr'), suggestion).length
    const heading = translate('for', { length: found, query: suggestion })
    expect(screen.getByRole('heading', { level: 2, name: heading })).toBeTruthy()
    expect(heading).not.toMatch(/\banswers?\b/)
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: translate('clearTheSearch') }))
    expect(box).toHaveProperty('value', '')

    await userEvent.type(box, 'zzqv')
    expect(screen.getByText(translate('nothingMatches', { query: 'zzqv' }))).toBeTruthy()
  })
})
