import { Avatar, AvatarFallback, AvatarImage } from '@helvetly/ui/components/avatar'
import { cn } from '@helvetly/ui/lib/utils'

import { Initials } from '@/components/initials'

/** A workspace member: their photo when they have one, else their initials. Clients keep `Initials`. */
export function UserAvatar({
  name,
  url,
  className,
}: {
  name: string
  url?: string | null
  className?: string
}) {
  return (
    <Avatar className={cn('size-7 after:hidden', className)}>
      {url && <AvatarImage src={url} alt="" className="ring-1 ring-black/[0.05] ring-inset" />}
      <AvatarFallback className="bg-transparent">
        <Initials name={name} className={cn('size-full', className)} />
      </AvatarFallback>
    </Avatar>
  )
}

/** A member as the API names one: `avatar_url` empty or null without a photo. */
export type PersonRef = { name: string; avatar_url?: string | null }

const PERSON_SIZES = {
  xs: 'size-4',
  sm: 'size-5',
  md: 'size-6',
  lg: 'size-7',
} as const

/**
 * The one way to show who did something: their photo (else initials) and name. `xs` sits in a line of muted text,
 * `md` in a list row.
 */
export function Person({
  person,
  size = 'md',
  className,
}: {
  person: PersonRef
  size?: keyof typeof PERSON_SIZES
  className?: string
}) {
  return (
    <span
      className={cn('inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle', className)}
    >
      <UserAvatar name={person.name} url={person.avatar_url} className={PERSON_SIZES[size]} />
      <span className="truncate">{person.name}</span>
    </span>
  )
}
