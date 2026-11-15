'use client'

import { locale, locales, localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { translate } from '@helvetly/ui/lib/i18n'
import { Check, Languages } from 'lucide-react'

export function LanguageMenuItems() {
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
            window.location.assign(localizedHref(path, language))
          }}
        >
          <span className="flex-1">{details.name}</span>
          {language === locale && <Check aria-hidden />}
        </DropdownMenuItem>
      ))}
    </>
  )
}

export function LanguageSwitcher() {
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
