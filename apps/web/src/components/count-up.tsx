'use client'

import { useEffect, useRef, useState } from 'react'

/** Counts from 0 to `to` the first time it is seen; the final figure is rendered before that. */
export function CountUp({
  to,
  decimals = 0,
  duration = 1600,
}: {
  to: number
  decimals?: number
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [value, setValue] = useState(to)

  useEffect(() => {
    const el = ref.current
    const still =
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!el || still) return
    const raf = { id: 0 }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      observer.disconnect()
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        setValue(to * (1 - (1 - t) ** 4))
        if (t < 1) raf.id = requestAnimationFrame(tick)
      }
      setValue(0)
      raf.id = requestAnimationFrame(tick)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf.id)
    }
  }, [to, duration])

  return (
    <span ref={ref} className="tabular-nums">
      {formatSwiss(value, decimals)}
    </span>
  )
}

/** 48260.5 → "48’260.50": the Swiss thousands mark, independent of the browser's locale data. */
export function formatSwiss(value: number, decimals = 0) {
  const [whole = '0', fraction] = value.toFixed(decimals).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '’')
  return fraction ? `${grouped}.${fraction}` : grouped
}
