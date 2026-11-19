import { http, HttpResponse, type RequestHandler } from 'msw'
import { setupWorker, type SetupWorker } from 'msw/browser'

const PING = '/__msw/ping'

type MswParameter =
  | RequestHandler[]
  | { handlers?: RequestHandler[] | Record<string, RequestHandler[]> }

/** A story's handlers, given as `msw: { handlers: [...] }` (or keyed groups, or a bare list). */
export function storyHandlers(parameter: MswParameter | undefined): RequestHandler[] {
  if (!parameter) return []
  if (Array.isArray(parameter)) return parameter
  const { handlers } = parameter
  if (!handlers) return []
  return Array.isArray(handlers) ? handlers : Object.values(handlers).flat()
}

// API requests no handler answered during the current story; `expectAllHandled` fails the story on any.
let unhandled: string[] = []

const options: Parameters<SetupWorker['start']>[0] = {
  quiet: true,
  onUnhandledRequest(request, print) {
    const url = new URL(request.url)
    if (!url.pathname.includes('/api/')) return
    unhandled.push(`${request.method} ${url.pathname}${url.search}`)
    print.error()
  },
}

/**
 * Storybook afterEach: an API request without a mock got the dev server's 404, so the screen ran on an error path
 * the story never meant to test (and passed or failed by timing). Every request a story makes needs a handler.
 */
export function expectAllHandled() {
  const missing = [...new Set(unhandled)]
  unhandled = []
  if (missing.length > 0) throw new Error(`No mock handler answered:\n${missing.join('\n')}`)
}

let started: Promise<SetupWorker> | undefined

async function start() {
  // The ping answers from the worker itself; it stays through every story's resetHandlers().
  const worker = setupWorker(http.get(PING, () => new HttpResponse(null, { status: 204 })))
  await worker.start(options)
  return worker
}

/** Whether the service worker still mocks this page's requests (a passed-through ping gets the dev server's 404). */
export const intercepting = () =>
  fetch(PING).then(
    (response) => response.status === 204,
    () => false,
  )

/**
 * Storybook loader: one mock worker per page, each story's `parameters.msw` handlers on a clean slate.
 * The browser may stop an idle service worker; it comes back without this page among its clients and lets every
 * request through to the network, so the story's app sees 404s. Before each story the worker proves it still
 * answers, and starts again when it does not.
 */
export function mswLoader(defaults: RequestHandler[] = []) {
  return async (context: { parameters: { msw?: MswParameter } }) => {
    started ??= start()
    const worker = await started
    if (!(await intercepting())) {
      await worker.stop()
      await worker.start(options)
      if (!(await intercepting()))
        throw new Error('The mock service worker does not answer this page')
    }
    worker.resetHandlers()
    unhandled = []
    // The app's defaults go last, so a story's own handlers win.
    const handlers = [...storyHandlers(context.parameters.msw), ...defaults]
    if (handlers.length > 0) worker.use(...handlers)
    return {}
  }
}
