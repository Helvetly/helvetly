import { Avatar, AvatarFallback, AvatarImage } from '@helvetly/ui/components/avatar'
import { cn } from '@helvetly/ui/lib/utils'

export const initialsOf = (name: string) =>
  name
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')

/** A 28px ringed circle: the photo when there is one, else two tiny uppercase letters. */
export function Initials({
  name,
  url,
  className,
}: {
  name: string
  url?: string | null
  className?: string
}) {
  return (
    <Avatar aria-hidden className={cn('size-7 text-[10px]', className)}>
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback className="text-[length:inherit] font-semibold tracking-wide text-foreground/75">
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}
