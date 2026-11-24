import { type Locale, localizedHref } from './index'
import slugs from './route-slugs.json'

// Keys are stable content IDs. Slugs are pinned independently of edits to article titles.
const translations: Record<string, Record<Exclude<Locale, 'en'>, string>> = slugs

export function publicHref(href: string, language: Locale): string {
  if (language === 'en' || !href.startsWith('/') || href.startsWith('//')) return href
  const [pathname = ''] = href.split(/[?#]/, 1)
  let parent = ''
  const translated = pathname.split('/').map((segment) => {
    if (!segment) return segment
    parent += `/${segment}`
    return translations[parent]?.[language] ?? segment
  })
  return localizedHref(translated.join('/') + href.slice(pathname.length), language)
}
