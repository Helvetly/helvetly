import type { ReactNode } from 'react'

import { Container, Eyebrow } from '@/components/section'

/** The top of an inner page: the hero's backdrop, smaller. */
export function PageHero({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  lead?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="relative overflow-x-clip pt-36 pb-12 sm:pt-44">
      <div aria-hidden className="grid-lines absolute inset-0 -z-10" />
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="aurora animate-drift bg-mint top-[-20%] left-[12%] h-[420px] w-[560px]" />
        <div className="aurora animate-drift-slow bg-lilac top-[-10%] right-[10%] h-[400px] w-[520px]" />
      </div>
      <Container className="flex flex-col items-center text-center">
        {eyebrow && <Eyebrow className="mb-6">{eyebrow}</Eyebrow>}
        <h1 className="rise text-subhero max-w-4xl font-semibold text-balance">{title}</h1>
        {lead && (
          <p
            style={{ ['--d' as string]: '100ms' }}
            className="rise text-lead mt-6 max-w-2xl text-balance text-muted-foreground"
          >
            {lead}
          </p>
        )}
        {children}
      </Container>
    </section>
  )
}
