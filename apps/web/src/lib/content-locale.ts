import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** English files keep stable slugs; another language can override any article or legal text. */
export function localizedContentFile(directory: string, file: string, language: string) {
  const translated = join(directory, language, file)
  return existsSync(translated) ? translated : join(directory, file)
}
