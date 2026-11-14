import { LogoMark } from '@helvetly/ui/components/logo'

import { Cta } from '@/components/cta'

export default function NotFound() {
  return (
    <main className="relative flex min-h-[80svh] flex-col items-center justify-center overflow-hidden px-4 pt-28 text-center">
      <div aria-hidden className="grid-lines absolute inset-0 -z-10" />
      <LogoMark className="size-16 text-brand-solid" />
      <p className="mt-6 font-mono text-body-sm text-muted-foreground">404</p>
      <h1 className="text-headline mt-2 font-semibold">
        Lost in the <span className="accent">Alps</span>
      </h1>
      <p className="text-lead mt-4 max-w-md text-balance text-muted-foreground">
        This page does not exist, or it moved. The way back down is right here.
      </p>
      <Cta href="/" className="mt-8">
        Back to the home page
      </Cta>
    </main>
  )
}
