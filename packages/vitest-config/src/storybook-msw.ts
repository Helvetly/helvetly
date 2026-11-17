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

const options: Parameters<SetupWorker['start']>[0] = {
  quiet: true,
  onUnhandledRequest(request, print) {
    if (new URL(request.url).pathname.startsWith('/api/')) print.error()
  },
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
export function mswLoader() {
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
    const handlers = storyHandlers(context.parameters.msw)
    if (handlers.length > 0) worker.use(...handlers)
    return {}
  }
}
