'use client'

import { browserLanguage, languageHref, locales, localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@helvetly/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Flag } from '@helvetly/ui/components/flag'
import { useLanguage, useTranslate } from '@helvetly/ui/components/language-provider'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Check, Languages } from 'lucide-react'

const languageFlags: Record<string, string> = { de: 'DE', en: 'GB', fr: 'FR', it: 'IT' }

/** Reloads the page in `language`, so module-level labels change too. */
function switchLanguage(language: string) {
  const path = window.location.pathname + window.location.search + window.location.hash
  window.location.assign(
    browserLanguage ? languageHref(path, language) : localizedHref(path, language),
  )
}

/** The languages as one segmented choice with their flags, for a settings page. */
export function LanguageChoice() {
  const current = useLanguage()
  const translate = useTranslate()
  return (
    <Segmented
      label={translate('language')}
      value={current}
      options={Object.entries(locales).map(([language, details]) => ({
        value: language,
        label: (
          <span lang={language} className="flex items-center gap-1.5">
            <Flag region={languageFlags[language] ?? ''} className="h-3 w-4 shrink-0 rounded-xs" />
            {details.name}
          </span>
        ),
      }))}
      onChange={(language) => language !== current && switchLanguage(language)}
    />
  )
}

export function LanguageMenuItems() {
  const current = useLanguage()
  const translate = useTranslate()
  if (Object.keys(locales).length < 2) return null

  return (
    <>
      <DropdownMenuLabel>{translate('language')}</DropdownMenuLabel>
      {Object.entries(locales).map(([language, details]) => (
        <DropdownMenuItem key={language} lang={language} onSelect={() => switchLanguage(language)}>
          <Flag region={languageFlags[language] ?? ''} className="h-3 w-4 shrink-0 rounded-xs" />
          <span className="flex-1">{details.name}</span>
          {language === current && <Check aria-hidden />}
        </DropdownMenuItem>
      ))}
    </>
  )
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const translate = useTranslate()
  if (Object.keys(locales).length < 2) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={className}>
          <Languages aria-hidden />
          {translate('changeLanguage')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <LanguageMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A quiet footer control: the current language's flag and name, opening a dialog with every language. For
 * screens where the language is chosen once (sign-in), so it should not compete with the form.
 */
export function LanguageDialogButton() {
  const current = useLanguage()
  const translate = useTranslate()
  if (Object.keys(locales).length < 2) return null
  const currentName = locales[current as keyof typeof locales]?.name ?? current

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          {/* The name says what it does and keeps the visible language in it. */}
          <span className="sr-only">{translate('changeLanguage')}: </span>
          <Flag region={languageFlags[current] ?? ''} className="h-3 w-4 shrink-0 rounded-xs" />
          {currentName}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{translate('changeLanguage')}</DialogTitle>
          <DialogDescription className="sr-only">{translate('language')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(locales).map(([language, details]) => (
            <Button
              key={language}
              lang={language}
              variant="outline"
              aria-pressed={language === current}
              className="justify-start aria-pressed:border-brand-solid/45 aria-pressed:bg-brand-surface/40"
              onClick={() => switchLanguage(language)}
            >
              <Flag
                region={languageFlags[language] ?? ''}
                className="h-3 w-4 shrink-0 rounded-xs"
              />
              <span className="flex-1 text-left">{details.name}</span>
              {language === current && <Check aria-hidden />}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
