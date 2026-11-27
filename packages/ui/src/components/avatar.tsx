'use client'

import { cn } from 'cn'
import { Avatar as AvatarPrimitive } from 'radix-ui'
import * as React from 'react'

/** Ring (1px) plus gap: 2px on tiny avatars, up to 4px on large ones, each side; rounded to even px so centred text stays on whole pixels. */
const inner = 'size-[round(down,calc(100%-clamp(4px,18%,8px)),2px)] rounded-[inherit]'

function Avatar({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: 'default' | 'sm' | 'lg'
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        // The ring is the ::after border on the box's edge; the photo or initials sit inside it with a gap that grows with the avatar (see `inner`).
        'group/avatar relative flex size-8 shrink-0 items-center justify-center rounded-full select-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-foreground/15 data-[size=lg]:size-10 data-[size=sm]:size-6',
        className,
      )}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square object-cover', inner, className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex items-center justify-center bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs',
        inner,
        className,
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        'absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground bg-blend-color ring-2 ring-background select-none',
        'group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden',
        'group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2',
        'group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2',
        className,
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        'group/avatar-group flex -space-x-2 *:data-[slot=avatar]:bg-background *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background',
        className,
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3',
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarBadge }
