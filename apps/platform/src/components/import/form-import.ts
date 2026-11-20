import { useMutation } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import type { ImportValue } from '@/lib/imports'
import { UNITS, type Unit } from '@/lib/invoices'

/**
 * A real entity form opened on an import record: it starts from the record's values, shows the import's issues on
 * its fields, and hands its input back to the import row instead of creating anything.
 */
export type FormImport = {
  /** The record's fields as the import holds them; the form maps them onto its own values. */
  data: Record<string, ImportValue>
  /** The server's issues with the record, by field. */
  issues: Record<string, string>
  /** The record's name, for the drawer's title. */
  name: string
  /** What the import says about the record (its file, a possible duplicate), above the form. */
  notice?: ReactNode
  /** Sends the form's input to the import row; resolves with the record's remaining issues (none: done). */
  submit: (input: object) => Promise<Record<string, string>>
}

/**
 * Hands a form's input to the import row: `onIssues` gets the record's remaining issues (the drawer closes itself
 * when there are none); a refused save is a toast. `onSettled` runs either way, to allow another submit.
 */
export function useImportSubmit(
  importing: FormImport | undefined,
  onIssues: (issues: Record<string, string>) => void,
  onSettled: () => void,
) {
  return useMutation({
    mutationFn: async (input: object) => (importing ? importing.submit(input) : {}),
    onSuccess: onIssues,
    onError: (error) => toast.error(errorMessage(error)),
    onSettled,
  })
}

/** A field the model read as text, trimmed ("" for none). */
export const textOf = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

const squash = (word: string) => word.toLowerCase().replace(/[\s_-]+/g, '')

export type Choice<T extends string> = { value: T; aliases: readonly string[] }

/**
 * The choice an extracted word stands for: its value or any alias, ignoring case, spaces and dashes. Null for a
 * word that is none of them; undefined for no word at all.
 */
export function choiceOf<T extends string>(
  value: unknown,
  choices: readonly Choice<T>[],
): T | null | undefined {
  const word = squash(textOf(value))
  if (!word) return undefined
  const found = choices.find((choice) =>
    [choice.value, ...choice.aliases].some((alias) => squash(alias) === word),
  )
  return found ? found.value : null
}

/** The message for an extracted value that is none of a field's choices. */
export const notAChoice = (value: unknown) =>
  translate('importValueNotAChoice', { value: textOf(value) })

/** The message for an extracted value that is not a date. */
export const notADate = (value: unknown) =>
  translate('importValueNotADate', { value: textOf(value) })

export const isCivilDate = (text: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`))

/** The units by value, label and short form ("h", "hours", "Stunden" when that is the label). */
export const UNIT_CHOICES: Choice<Unit>[] = UNITS.map((unit) => ({
  value: unit.value,
  aliases: [unit.label, unit.short],
}))
