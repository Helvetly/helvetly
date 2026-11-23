import { localizedHref } from '@helvetly/i18n'

/**
 * Puts a page's view state (filters, paging, the open drawer) in the URL without a navigation.
 * Next.js keeps useSearchParams in step with the History API, while router.replace/push asks the
 * dev server for an RSC payload first, so a drawer waited for a server round trip to open or close.
 */
export function setUrlQuery(pathname: string, query: URLSearchParams, push = false) {
  const text = query.toString()
  const url = localizedHref(text ? `${pathname}?${text}` : pathname)
  // Opening what is already open (a double-click) adds no second history entry to step back through.
  const here = url === window.location.pathname + window.location.search
  if (push && !here) window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
}
