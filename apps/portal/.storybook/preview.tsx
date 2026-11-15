import '@helvetly/ui/globals.css'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { fontClassName } from '@helvetly/ui/lib/fonts'
import { cn } from '@helvetly/ui/lib/utils'
import type { Preview } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mswLoader } from 'msw-storybook-addon/csf3'
import { setupWorker } from 'msw/browser'
import { useState, type ReactNode } from 'react'
import { configure } from 'storybook/test'

// findBy…/waitFor give up after 1 s by default. In the full browser run a heavy screen can take longer to render
// (settings, books, ledger), so a random one failed although nothing was wrong; 5 s waits for slow renders only and
// still fails a story whose expected state never appears.
configure({ asyncUtilTimeout: 5000 })

// In the test run enter animations end at once: a play asserting a dialog or sheet that was still fading in read
// opacity 0 under CI load. Exit animations, delays and loops keep their timing; Storybook itself keeps all motion.
if (import.meta.env.MODE === 'test') {
  const style = document.createElement('style')
  style.textContent = `[class*='animate-in'] { animation-duration: 0s !important; }`
  document.head.append(style)
}

function StoryProviders({
  children,
  ownMain,
  bare,
}: {
  children: ReactNode
  ownMain: boolean
  bare: boolean
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Infinity },
          mutations: { retry: false },
        },
      }),
  )
  const Surface = ownMain ? 'div' : 'main'
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        {/* `bare`: a whole app shell (the "Pages/…" stories) fills the frame like the real app. */}
        <Surface className={cn('min-h-screen bg-background text-foreground', !bare && 'p-6')}>
          {children}
        </Surface>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

// Pages keep view state in the real URL (setUrlQuery: `/quotes?id=…`), and every story of a file shares one
// document; without a reset, the next story would open on the last one's drawer, tab or filter.
const startUrl = window.location.href

const preview: Preview = {
  beforeEach: (context) => {
    window.history.replaceState(null, '', startUrl)
    const root = document.documentElement
    root.classList.add(...fontClassName.split(' '))
    const previous = root.classList.contains('dark')
    root.classList.toggle('dark', context.parameters.dark === true)
    return () => {
      root.classList.toggle('dark', previous)
    }
  },
  decorators: [
    (Story, context) => (
      <StoryProviders
        key={context.id}
        ownMain={context.parameters.ownMain === true}
        bare={context.parameters.bare === true}
      >
        <Story />
      </StoryProviders>
    ),
  ],
  loaders: [
    mswLoader(async () => {
      const worker = setupWorker()
      await worker.start({
        quiet: true,
        onUnhandledRequest(request, print) {
          if (new URL(request.url).pathname.startsWith('/api/')) print.error()
        },
      })
      return worker
    }),
  ],
  parameters: {
    nextjs: { appDirectory: true },
    a11y: { test: 'error' },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
}

export default preview
