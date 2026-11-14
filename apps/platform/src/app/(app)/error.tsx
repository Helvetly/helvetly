'use client'

import { Button } from '@helvetly/ui/components/button'
import { ErrorState, type PageError } from '@helvetly/ui/components/error-state'
import { LayoutDashboard } from 'lucide-react'
import Link from 'next/link'

import { PageHeader } from '@/components/shell/page-header'

/** A crashed page inside the shell: the sidebar and top bar stay, so nobody is lost. */
export default function PageError({ reset }: { error: PageError; reset: () => void }) {
  return (
    <>
      {/* The bar keeps the page's frame (white panel, bell) around the message. */}
      <PageHeader tabs={['Something went wrong']} />
      <ErrorState
        reset={reset}
        home={
          <Button asChild variant="outline">
            <Link href="/">
              <LayoutDashboard /> Go to dashboard
            </Link>
          </Button>
        }
      />
    </>
  )
}
