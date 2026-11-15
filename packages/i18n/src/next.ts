import configuration from './locales.json'

const language = process.env.HELVETLY_BUILD_LOCALE ?? configuration.defaultLocale
if (!Object.hasOwn(configuration.locales, language))
  throw new Error(`Unsupported build locale: ${language}`)

export const localizedNextConfig = {
  basePath: language === configuration.defaultLocale ? '' : `/${language}`,
  env: { NEXT_PUBLIC_LOCALE: language },
  transpilePackages: ['@helvetly/ui', '@helvetly/i18n'],
}
