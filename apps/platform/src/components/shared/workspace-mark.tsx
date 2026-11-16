'use client'
import { cn } from '@helvetly/ui/lib/utils'
import Image from 'next/image'
import { useState } from 'react'

import { initialsOf } from '@/components/initials'

/**
 * A workspace's mark: its own logo when it has one, else the initial on a dark tile. The initial also stands in
 * when the image cannot load. The tile keeps its size either way, so nothing around it moves.
 */
export function WorkspaceMark({
  name,
  logoUrl,
  className,
}: {
  name: string
  logoUrl?: string | null
  className?: string
}) {
  // A new URL (a replaced logo) gets a fresh try.
  const [failed, setFailed] = useState<string | null>(null)
  const logo = logoUrl && failed !== logoUrl ? logoUrl : null
  return (
    <span
      aria-hidden
      // The letter keeps its colour on the tile: menu items recolour a child on hover.
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[9px] text-[14px] font-semibold',
        logo
          ? 'bg-white ring-1 ring-black/10 dark:ring-white/15'
          : 'bg-linear-to-b from-[#3a3a3e] to-[#1c1c1f] text-white! shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.12)] dark:from-[#f4f4f5] dark:to-[#dcdcdf] dark:text-[#161618]!',
        className,
      )}
    >
      {logo ? (
        <Image
          src={logo}
          alt=""
          fill
          unoptimized
          sizes="32px"
          className="object-contain"
          onError={() => setFailed(logo)}
        />
      ) : (
        initialsOf(name).slice(0, 1) || '?'
      )}
    </span>
  )
}
