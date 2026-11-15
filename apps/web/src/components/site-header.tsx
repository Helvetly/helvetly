'use client'
import { localizedHref } from '@helvetly/i18n'
import { Logo } from '@helvetly/ui/components/logo'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@helvetly/ui/components/sheet'
import { Menu } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Cta } from '@/components/cta'
import { cn } from '@/lib/cn'
import { translate } from '@/lib/i18n'
import { NAV, SIGN_IN_URL, START_URL } from '@/lib/site'

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  // Section anchors (/#features) are never 'current'; pages are, including their sub-pages.
  const current = (href: string) =>
    !href.includes('#') && (pathname === href || pathname.startsWith(`${href}/`))

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-4">
      <div
        className={cn(
          'mx-auto flex h-14 max-w-6xl items-center gap-6 rounded-full border px-2 pl-4 backdrop-blur-xl backdrop-saturate-150 transition-[background-color,border-color,box-shadow] duration-300',
          // Always a glass pill, so the menu reads on any backdrop; a touch more solid once scrolled.
          scrolled
            ? 'border-site-line bg-site/85 shadow-[0_8px_30px_-12px_rgb(85_39_201/0.25)]'
            : 'bg-site/55 dark:border-site-line border-white/60 shadow-[0_4px_20px_-10px_rgb(85_39_201/0.15)]',
        )}
      >
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo className="size-7" />
          <span className="text-title-sm font-semibold tracking-tight">
            {translate('helvetly')}
          </span>
        </Link>

        <nav
          aria-label={translate('main')}
          className="hidden flex-1 items-center justify-center gap-0.5 md:flex"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current(item.href) ? 'page' : undefined}
              className="hover:bg-lilac/60 aria-[current=page]:bg-lilac aria-[current=page]:text-lilac-ink inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-body font-medium text-foreground/75 transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <a
            href={localizedHref(SIGN_IN_URL)}
            className="hover:bg-lilac/60 rounded-full px-3.5 py-1.5 text-body font-medium text-foreground/75 transition-colors hover:text-foreground"
          >
            {translate('signIn')}
          </a>
          <Cta href={START_URL} className="h-9 px-4 text-body-sm">
            {translate('startFreeTrial')}
          </Cta>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            aria-label={translate('openMenu')}
            className="hover:bg-site-tint ml-auto inline-flex size-10 items-center justify-center rounded-full text-foreground md:hidden"
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="right" className="w-full max-w-xs gap-0 p-0">
            <SheetTitle className="flex items-center gap-2 px-5 pt-5">
              <Logo className="size-7" />
              {translate('helvetly')}
            </SheetTitle>
            <nav aria-label={translate('mobile')} className="flex flex-col gap-1 p-3 pt-6">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="hover:bg-site-tint rounded-xl px-3 py-3 text-title-sm font-medium"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="border-site-line mt-auto flex flex-col gap-2 border-t p-4">
              <Cta href={START_URL}>{translate('startFreeTrial')}</Cta>
              <Cta href={SIGN_IN_URL} variant="outline">
                {translate('signIn')}
              </Cta>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}
