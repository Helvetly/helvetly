import configuration from './locales.json'

export const browserLanguageNextConfig = {
  env: { NEXT_PUBLIC_I18N_MODE: 'browser', NEXT_PUBLIC_LOCALE: configuration.defaultLocale },
  transpilePackages: ['@helvetly/ui', '@helvetly/i18n'],
}
