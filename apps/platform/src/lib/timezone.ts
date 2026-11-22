import { setDisplayTimeZone } from '@helvetly/ui/lib/format'

// The session workspace's IANA zone, kept here so pure date helpers need no hook.
// shortcut: module state, set by useSession; fine while one workspace is active per tab.
let workspaceTimezone = 'Europe/Zurich' // until the session loads

export const setWorkspaceTimezone = (tz: string | undefined) => {
  if (!tz) return
  workspaceTimezone = tz
  // List timestamps (created, updated) show their day in the same zone the date filters use.
  setDisplayTimeZone(tz)
}

export const getWorkspaceTimezone = () => workspaceTimezone

/** Today's civil date (YYYY-MM-DD) in `tz`, the workspace's by default. */
export const todayIn = (tz = workspaceTimezone, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
