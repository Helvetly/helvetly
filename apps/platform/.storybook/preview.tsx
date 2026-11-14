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

import { RecordDrawers } from '../src/components/record-drawers'
import { clippedRings } from '../src/stories/focus-ring'

// findBy…/waitFor give up after 1 s by default. In the full browser run a heavy screen can take longer to render
// (settings, books, ledger), so a random one failed although nothing was wrong; 5 s waits for slow renders only and
// still fails a story whose expected state never appears.
configure({ asyncUtilTimeout: 5000 })

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
          <RecordDrawers>{children}</RecordDrawers>
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
  // Every story, after its play: no visible control's focus ring is cut off by an ancestor's overflow.
  afterEach: async () => {
    // Measure the settled layout: a drawer still sliding in or a list still growing is not a cut-off.
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    // Capped: an animation that never plays (paused, off-screen) must not hang the story.
    await Promise.race([
      Promise.allSettled(finite.map((animation) => animation.finished)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ])
    const clipped = clippedRings(document)
    if (clipped.length > 0) throw new Error(`Focus ring cut off:\n${clipped.join('\n')}`)
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
    options: {
      storySort: {
        order: [
          'Design system',
          'Shared flows',
          'Authentication',
          'Catalogue',
          'Clients',
          'Expenses',
          'Heidi',
        ],
      },
    },
  },
}

export default preview
