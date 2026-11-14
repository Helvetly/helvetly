'use client'

import { useEffect } from 'react'

/**
 * Marks every [data-reveal] element with data-shown once it scrolls into view (site.css animates it),
 * including elements a client-side navigation adds later.
 */
export function RevealObserver() {
  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.setAttribute('data-shown', '')
          seen.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    const watch = () => {
      for (const el of document.querySelectorAll('[data-reveal]:not([data-shown])'))
        seen.observe(el)
    }
    watch()
    const added = new MutationObserver(watch)
    added.observe(document.body, { childList: true, subtree: true })
    return () => {
      added.disconnect()
      seen.disconnect()
    }
  }, [])
  return null
}
