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
