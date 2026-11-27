import Link from 'next/link'
import type { ComponentProps } from 'react'

import { PLATFORM_URL } from '@/lib/site'

export function SiteLink({ children, href, ...props }: ComponentProps<'a'> & { href: string }) {
  // Next's Link strips the slash from language homes, which the static host serves as /<lang>/.
  const [path] = href.split(/[?#]/, 1)
  return href.startsWith('http') || path?.endsWith('/') ? (
    <a href={href} {...props} rel={href.startsWith(`${PLATFORM_URL}/`) ? 'nofollow' : props.rel}>
      {children}
    </a>
  ) : (
    <Link href={href} {...props}>
      {children}
    </Link>
  )
}
