// A test that prints an error or a warning it did not ask for fails: an unhandled API request (msw), an update
// outside act(), a suspended act that was not awaited, a React render error. Each one is a test running a path it
// does not assert. A test that means to log spies on console and asserts on it; a spy with its own
// implementation keeps the message from reaching this guard.
let printed: string[] = []

const text = (args: unknown[]) =>
  args.map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : String(arg))).join(' ')

/** Records every console.error and console.warn from now on; it still prints. */
export function guardConsole() {
  for (const level of ['error', 'warn'] as const) {
    const print = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      printed.push(`console.${level}: ${text(args)}`)
      print(...args)
    }
  }
}

/** Throws when anything was printed since the last call. */
export function expectQuietConsole() {
  const messages = printed
  printed = []
  if (messages.length > 0)
    throw new Error(
      `Unexpected console output (fix the cause, or spy and assert on it):\n${messages.join('\n')}`,
    )
}
