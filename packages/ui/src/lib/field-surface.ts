/**
 * The one look of every field one types into or picks from: a card-white box with a hairline border and a soft
 * bottom shadow, a ring while focused, red when invalid, dimmed when disabled. Inputs, textareas, selects and
 * combobox triggers carry it themselves; a composite field (an input group, a textarea with its tools, a tag
 * input) carries it on its outer box, and the controls inside it are bare. Nothing overrides it:
 * `e2e/visual/field-surface.spec.ts` compares every field of every story with it, in both themes.
 * No imports, so the visual suite can read it too.
 */
export const fieldSurface =
  'rounded-md border border-input bg-card shadow-xs transition-[color,box-shadow] outline-none dark:bg-input/30 ' +
  // Focus: the field itself, or the control inside a composite one.
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 has-[input:focus-visible,textarea:focus-visible]:border-ring has-[input:focus-visible,textarea:focus-visible]:ring-3 has-[input:focus-visible,textarea:focus-visible]:ring-ring/50 ' +
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20 has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:has-[[aria-invalid=true]]:border-destructive/50 dark:has-[[aria-invalid=true]]:ring-destructive/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 has-[input:disabled,textarea:disabled]:opacity-50'

/** A single-line field: the surface, 2.25rem high. */
export const fieldClass = `${fieldSurface} h-9 w-full min-w-0 px-3 text-sm placeholder:text-placeholder`
