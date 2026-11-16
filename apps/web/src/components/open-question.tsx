'use client'

import { useEffect } from 'react'

/** Opens the question a link points at (`/faq#trial`), which not every browser does for a closed <details>. */
export function OpenQuestion() {
  useEffect(() => {
    const open = () => {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
      if (target instanceof HTMLDetailsElement) target.open = true
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])
  return null
}
