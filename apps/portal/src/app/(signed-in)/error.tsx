'use client'

import { Button } from '@helvetly/ui/components/button'
import { ErrorState, type PageError } from '@helvetly/ui/components/error-state'
import { House } from 'lucide-react'
import Link from 'next/link'

/** A crashed portal page inside the portal's frame, with its own way home. */
export default function PageError({ reset }: { error: PageError; reset: () => void }) {
  return (
    <ErrorState
      reset={reset}
      home={
        <Button asChild variant="outline">
          <Link href="/">
            <House /> Go to overview
          </Link>
        </Button>
      }
    />
  )
}
