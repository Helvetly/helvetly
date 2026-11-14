import type { ImportKind } from '@/lib/imports'

// Files attached in Heidi travel to the import drawer in memory: a File cannot go through the URL.
let pending: { kind: ImportKind; files: File[] } | null = null

/** Heidi: the next import drawer of `kind` starts with these files chosen. */
export function handOffImport(kind: ImportKind, files: File[]) {
  pending = files.length ? { kind, files } : null
}

/** The files handed over for `kind`, without taking them (safe in a state initializer). */
export function peekHandOff(kind: ImportKind): File[] {
  return pending?.kind === kind ? pending.files : []
}

/** Called once the drawer holds them, so a later drawer starts empty. */
export function clearHandOff() {
  pending = null
}
