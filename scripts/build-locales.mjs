import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const configuration = JSON.parse(
  readFileSync(new URL('../packages/i18n/src/locales.json', import.meta.url), 'utf8'),
)

/** Each language is an independent static export; no request-time locale or global React state. */
export function buildLocales({
  cwd = process.cwd(),
  config = configuration,
  build = (language) => {
    const result = spawnSync('pnpm', ['exec', 'next', 'build'], {
      cwd,
      env: { ...process.env, HELVETLY_BUILD_LOCALE: language },
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0)
      throw new Error(`Static export failed for ${language} (${result.status})`)
  },
} = {}) {
  const languages = Object.keys(config.locales)
  if (!languages.includes(config.defaultLocale)) throw new Error('Default locale is not enabled')
  for (const language of languages) {
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language))
      throw new Error(`Invalid locale: ${language}`)
  }

  const projectTmp = join(tmpdir(), 'helvetly')
  mkdirSync(projectTmp, { recursive: true })
  const staging = mkdtempSync(join(projectTmp, 'locale-export-'))
  const output = join(cwd, 'out')
  try {
    // Export the default language last: Next's .next metadata then also describes the root export.
    for (const language of [
      ...languages.filter((value) => value !== config.defaultLocale),
      config.defaultLocale,
    ]) {
      build(language)
      if (!existsSync(join(output, 'index.html')))
        throw new Error(`Missing index.html for ${language}`)
      const destination = language === config.defaultLocale ? staging : join(staging, language)
      if (language === config.defaultLocale) {
        for (const other of languages.filter((value) => value !== config.defaultLocale)) {
          if (existsSync(join(output, other)))
            throw new Error(`Route conflicts with locale: ${other}`)
        }
      }
      cpSync(output, destination, { recursive: true })
    }
    rmSync(output, { recursive: true, force: true })
    cpSync(staging, output, { recursive: true })
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  buildLocales()
