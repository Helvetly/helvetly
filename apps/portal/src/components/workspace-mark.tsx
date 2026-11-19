'use client'
import { cn } from '@helvetly/ui/lib/utils'
import Image from 'next/image'
import { useState } from 'react'

import { initialsOf } from './portal-bits'

/** The supplier's logo on a white tile, else (or when it cannot load) its initials on a brand tile. */
export function WorkspaceMark({
  name,
  logoUrl,
  className,
}: {
  name: string
  logoUrl?: string | null
  className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const logo = logoUrl && failed !== logoUrl ? logoUrl : null
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg text-caption font-semibold',
        logo ? 'bg-white ring-1 ring-black/10 dark:ring-white/15' : 'bg-brand-surface text-brand',
        className,
      )}
    >
      {logo ? (
        <Image
          src={logo}
          alt=""
          width={88}
          height={88}
          unoptimized
          className="size-full object-contain"
          onError={() => setFailed(logo)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  )
}
