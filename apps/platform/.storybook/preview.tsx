import '@helvetly/ui/globals.css'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { fontClassName } from '@helvetly/ui/lib/fonts'
import { cn } from '@helvetly/ui/lib/utils'
import { expectQuietConsole, guardConsole } from '@helvetly/vitest-config/console-guard'
import { expectAllHandled, mswLoader } from '@helvetly/vitest-config/storybook-msw'
import type { Preview } from '@storybook/nextjs-vite'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { configure, getConfig } from 'storybook/test'

import { RecordDrawers } from '../src/components/record-drawers'
import { clippedRings } from '../src/stories/focus-ring'
import { storyDefaults } from '../src/stories/screen-fixtures'

// findBy…/waitFor give up after 1 s by default. In the full browser run a heavy screen can take longer to render
// (settings, books, ledger), so a random one failed although nothing was wrong; 5 s waits for slow renders only and
// still fails a story whose expected state never appears.
configure({ asyncUtilTimeout: 5000 })

// Only the test run fails a story on console output; the built Storybook (and its screenshots) shows the story.
if (import.meta.env.MODE === 'test') guardConsole()

// In the test run enter animations end at once: a play asserting a dialog or sheet that was still fading in read
// opacity 0 under CI load. Exit animations, delays and loops keep their timing; Storybook itself keeps all motion.
if (import.meta.env.MODE === 'test') {
  const style = document.createElement('style')
  style.textContent = `[class*='animate-in'] { animation-duration: 0s !important; }`
  document.head.append(style)
}

// A query whose mock answered without its data (`{ data }` left out) left the screen on a state the app never sees.
let undefinedQueries: string[] = []
const queryCache = () =>
  new QueryCache({
    onError: (error) => {
      if (error.message.endsWith('data is undefined')) undefinedQueries.push(error.message)
    },
  })

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
        queryCache: queryCache(),
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
    // Storybook wraps every Testing Library event in act (set per story, hence here). A blur that user-event
    // fires inside one event dispatches `change` through the same wrapper, and act inside a busy act makes React
    // warn "suspended inside an act scope". The outer act already flushes the nested event's updates.
    const wrap = getConfig().eventWrapper
    let inside = false
    configure({
      eventWrapper: (event) => {
        if (inside) return event()
        inside = true
        try {
          return wrap(event)
        } finally {
          inside = false
        }
      },
    })
    undefinedQueries = []
    window.history.replaceState(null, '', startUrl)
    // sonner replays every toast still open when a Toaster mounts: the last story's toast would show in this one.
    toast.dismiss()
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
    expectAllHandled()
    expectQuietConsole()
    if (undefinedQueries.length > 0)
      throw new Error(`Query answered without data:\n${[...new Set(undefinedQueries)].join('\n')}`)
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
  loaders: [mswLoader(storyDefaults)],
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
