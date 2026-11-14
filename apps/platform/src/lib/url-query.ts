/**
 * Puts a page's view state (filters, paging, the open drawer) in the URL without a navigation.
 * Next.js keeps useSearchParams in step with the History API, while router.replace/push asks the
 * dev server for an RSC payload first, so a drawer waited for a server round trip to open or close.
 */
export function setUrlQuery(pathname: string, query: URLSearchParams, push = false) {
  const text = query.toString()
  const url = text ? `${pathname}?${text}` : pathname
  if (push) window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
}
