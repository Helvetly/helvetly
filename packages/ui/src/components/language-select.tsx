'use client'

import { Combobox, type Option } from '@helvetly/ui/components/combobox'
import { Flag } from '@helvetly/ui/components/flag'
import { useLanguage } from '@helvetly/ui/components/language-provider'

/** The flag shown beside a language; a language without one shows its name alone. */
export const languageFlags: Record<string, string> = { de: 'DE', en: 'GB', fr: 'FR', it: 'IT' }

/** A language's name in that language, capitalised as a heading: "Français", not "français". */
export function nativeLanguageName(code: string) {
  const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1)
}

function LanguageFlag({ code }: { code: string }) {
  return <Flag region={languageFlags[code] ?? ''} className="h-3 w-4 shrink-0 rounded-xs" />
}

/**
 * A language picker: each language's flag and own name, its name in the interface language as a hint (and search
 * term) when that differs. A search box appears once the list is long.
 */
export function LanguageSelect<T extends string>({
  id,
  value,
  languages,
  onChange,
  label,
  placeholder,
  invalid,
  className,
}: {
  id?: string
  value: T
  languages: readonly T[]
  onChange: (language: T) => void
  /** The accessible name when no <label> points at `id`. */
  label?: string
  placeholder: string
  invalid?: boolean
  className?: string
}) {
  const interfaceNames = new Intl.DisplayNames([useLanguage()], { type: 'language' })
  const options: Option[] = languages.map((code) => {
    const name = nativeLanguageName(code)
    const local = interfaceNames.of(code) ?? code
    return {
      value: code,
      label: name,
      hint: local.toLowerCase() === name.toLowerCase() ? undefined : local,
      icon: <LanguageFlag code={code} />,
    }
  })
  return (
    <Combobox
      id={id}
      value={value}
      options={options}
      label={label}
      placeholder={placeholder}
      invalid={invalid}
      className={className}
      renderValue={(option) => (
        <span className="flex min-w-0 items-center gap-2">
          {option.icon}
          <span className="truncate">{option.label}</span>
        </span>
      )}
      onChange={(code) => {
        const chosen = languages.find((language) => language === code)
        if (chosen) onChange(chosen)
      }}
    />
  )
}
