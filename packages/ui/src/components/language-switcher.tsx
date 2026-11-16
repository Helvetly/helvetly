'use client'

import { browserLanguage, languageHref, locales, localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { useLanguage, useTranslate } from '@helvetly/ui/components/language-provider'
import { Check, Languages } from 'lucide-react'

export function LanguageMenuItems() {
  const current = useLanguage()
  const translate = useTranslate()
  if (Object.keys(locales).length < 2) return null

  return (
    <>
      <DropdownMenuLabel>{translate('language')}</DropdownMenuLabel>
      {Object.entries(locales).map(([language, details]) => (
        <DropdownMenuItem
          key={language}
          lang={language}
          onSelect={() => {
            const path = window.location.pathname + window.location.search + window.location.hash
            window.location.assign(
              browserLanguage ? languageHref(path, language) : localizedHref(path, language),
            )
          }}
        >
          <span className="flex-1">{details.name}</span>
          {language === current && <Check aria-hidden />}
        </DropdownMenuItem>
      ))}
    </>
  )
}

export function LanguageSwitcher() {
  const translate = useTranslate()
  if (Object.keys(locales).length < 2) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={translate('language')}>
          <Languages aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <LanguageMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
