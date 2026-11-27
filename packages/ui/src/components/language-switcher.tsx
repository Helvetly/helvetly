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
import { languageFlags } from '@helvetly/ui/components/language-select'
import { Check, Globe, Languages } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'

/** Reloads the page in `language`, so module-level labels change too. */
function switchLanguage(language: string) {
  const path = window.location.pathname + window.location.search + window.location.hash
  if (browserLanguage) {
    window.location.assign(languageHref(path, language))
    return
  }
  const alternate = document.querySelector<HTMLLinkElement>(
    `link[rel="alternate"][hreflang="${language}"]`,
  )
  const publicUrl = alternate
    ? new URL(alternate.href).pathname + window.location.search + window.location.hash
    : localizedHref(path, language)
  window.location.assign(publicUrl)
}

function LanguageMenuItems() {
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

/**
 * One "Language" row inside an account menu, the current language's flag and name at its right. `onSelect` opens
 * the `LanguageDialog`, which sits outside the menu so it outlives the menu closing.
 */
export function LanguageMenuItem({ onSelect }: { onSelect: () => void }) {
  const translate = useTranslate()
  const language = useCurrentLanguage()
  if (Object.keys(locales).length < 2) return null

  return (
    <DropdownMenuItem onSelect={onSelect}>
      <Languages aria-hidden />
      <span className="flex-1">{translate('language')}</span>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Flag region={language.region} className="h-3 w-4 shrink-0 rounded-xs" />
        {language.name}
      </span>
    </DropdownMenuItem>
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

/** The interface language's name and the region of its flag, for a settings row that shows it. */
export function useCurrentLanguage() {
  const current = useLanguage()
  return {
    name: locales[current as keyof typeof locales]?.name ?? current,
    region: languageFlags[current] ?? '',
  }
}

/** The language picker's contents: every language as a button, the current one pressed. */
function LanguageDialogContent({ returnFocus }: { returnFocus?: RefObject<HTMLElement | null> }) {
  const current = useLanguage()
  const translate = useTranslate()
  return (
    <DialogContent
      className="sm:max-w-sm"
      onCloseAutoFocus={
        returnFocus &&
        ((event) => {
          event.preventDefault()
          returnFocus.current?.focus()
        })
      }
    >
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
            <Flag region={languageFlags[language] ?? ''} className="h-3 w-4 shrink-0 rounded-xs" />
            <span className="flex-1 text-left">{details.name}</span>
            {language === current && <Check aria-hidden />}
          </Button>
        ))}
      </div>
    </DialogContent>
  )
}

/**
 * The language picker without a trigger of its own, opened from a menu row (`LanguageMenuItem`). The row is gone
 * once it closes, so focus goes back to `returnFocus` (the menu's trigger).
 */
export function LanguageDialog({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus: RefObject<HTMLElement | null>
}) {
  if (Object.keys(locales).length < 2) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <LanguageDialogContent returnFocus={returnFocus} />
    </Dialog>
  )
}

/**
 * A quiet footer control: the current language's flag and name, opening a dialog with every language. For
 * screens where the language is chosen once (sign-in), so it should not compete with the form. `children` replaces
 * that trigger (a settings row's own button).
 */
export function LanguageDialogButton({ children }: { children?: ReactNode }) {
  const current = useLanguage()
  const translate = useTranslate()
  if (Object.keys(locales).length < 2) return null
  const currentName = locales[current as keyof typeof locales]?.name ?? current

  return (
    <Dialog>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="xs" className="rounded-full px-2.5 text-muted-foreground">
            {/* The name says what it does and keeps the visible language in it. */}
            <span className="sr-only">{translate('changeLanguage')}: </span>
            <Globe aria-hidden />
            {currentName}
          </Button>
        )}
      </DialogTrigger>
      <LanguageDialogContent />
    </Dialog>
  )
}
