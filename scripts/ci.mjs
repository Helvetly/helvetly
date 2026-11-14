import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const full = { backend: true, frontend: true, e2e: true, build: true }

export function selectChecks(paths) {
  if (!paths.length) return { ...full }
  const checks = { backend: false, frontend: false, e2e: false, build: false }
  for (const path of paths) {
    // Only prose in known locations is documentation; embedded Markdown is application code, and so
    // are the legal texts the web site renders at build time (apps/web/content/legal, under apps/web below).
    if (/^(docs\/.*\.md|(?:README|CONTRIBUTING|AGENTS|SECURITY)\.md|LICENSE|NOTICE)$/.test(path))
      continue
    // Workflows that neither build nor test the code: run cancellation and the release (which builds the image).
    if (/^\.github\/workflows\/(cancel-closed-pr|release)\.yml$/.test(path)) continue
    if (/\.(sql|xsd)$/.test(path)) return { ...full }
    if (/^apps\/api\/(internal|cmd)\//.test(path)) {
      checks.backend = checks.e2e = checks.build = true
    } else if (/^(apps\/(platform|portal)\/(src|public)|packages\/ui\/src)\//.test(path)) {
      checks.frontend = checks.e2e = checks.build = true
    } else if (/^apps\/web\/(src|public|content)\//.test(path)) {
      checks.frontend = checks.build = true
    } else if (path.startsWith('e2e/tests/')) {
      checks.e2e = true
    } else {
      // Config, tooling, dependencies and unfamiliar paths fail open to the full test suite.
      return { ...full }
    }
  }
  return checks
}

export function detectChecks(eventName, event, sha, cwd = process.cwd(), baseVerified = false) {
  // A push to main is scoped against the previous main commit only when that commit's own CI run
  // passed: unchanged areas were verified there. Otherwise (a failed, cancelled or still running
  // predecessor, a force push), and for ready_for_review, dispatch and merge groups, run everything.
  const base =
    eventName === 'pull_request' && event.action !== 'ready_for_review'
      ? event.pull_request?.base?.sha
      : eventName === 'push' && baseVerified && !event.forced
        ? event.before
        : undefined
  if (![base, sha].every((value) => /^[a-f0-9]{40}$/.test(value ?? ''))) return { ...full }
  if (/^0+$/.test(base)) return { ...full }
  try {
    // Compare the entire PR merge tree (or pushed range) to its base, not just the latest commit. No rename
    // detection: both the removed path and the added path must participate in selection.
    const paths = execFileSync(
      'git',
      ['diff', '--name-only', '-z', '--no-renames', base, sha, '--'],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
      .split('\0')
      .filter(Boolean)
    return selectChecks(paths)
  } catch {
    console.error('Change detection failed; selecting all checks.')
    return { ...full }
  }
}

// Whether the CI run of a previous main commit succeeded. Any doubt (no run, API error) is a no.
export async function pushRunPassed(repository, sha, token, request = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '') || !token)
    return false
  try {
    const response = await request(
      `https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?event=push&head_sha=${sha}&per_page=20`,
      { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` } },
    )
    if (!response.ok) return false
    const { workflow_runs: runs } = await response.json()
    // A run's conclusion is that of its latest attempt, so a passed run later rerun and failed is no.
    return Array.isArray(runs) && runs.some((run) => run.conclusion === 'success')
  } catch {
    return false
  }
}

export function verifyResults(needs, draft) {
  if (draft) throw new Error('Draft PR: full verification is required after ready_for_review.')
  for (const job of ['changes', 'quick']) {
    if (needs[job]?.result !== 'success') throw new Error(`${job} did not succeed`)
  }
  const checks = needs.changes.outputs
  for (const key of Object.keys(full)) {
    if (!['true', 'false'].includes(checks?.[key])) throw new Error(`Missing selection: ${key}`)
  }
  const jobs = {
    static: checks.build,
    go: checks.backend,
    einvoice: checks.backend,
    vitest: checks.frontend,
    coverage: checks.frontend,
    visual: checks.frontend,
    e2e: checks.e2e,
  }
  // A job in `needs` that this map does not know would pass unchecked.
  for (const job of Object.keys(needs)) {
    if (!['changes', 'quick', ...Object.keys(jobs)].includes(job))
      throw new Error(`${job}: not checked by verifyResults`)
  }
  for (const [job, selected] of Object.entries(jobs)) {
    const result = needs[job]?.result
    if (selected === 'true' ? result !== 'success' : result !== 'skipped')
      throw new Error(
        `${job}: expected ${selected === 'true' ? 'success' : 'skipped'}, got ${result}`,
      )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'select') {
    let checks = { ...full }
    try {
      const eventName = process.env.GITHUB_EVENT_NAME
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
      const baseVerified =
        eventName === 'push' &&
        (await pushRunPassed(process.env.GITHUB_REPOSITORY, event.before, process.env.GITHUB_TOKEN))
      checks = detectChecks(eventName, event, process.env.GITHUB_SHA, process.cwd(), baseVerified)
    } catch {
      console.error('Event could not be read; selecting all checks.')
    }
    const output = Object.entries(checks)
      .map(([key, value]) => `${key}=${value}\n`)
      .join('')
    appendFileSync(process.env.GITHUB_OUTPUT, output)
    console.log(output)
  } else if (process.argv[2] === 'verify') {
    verifyResults(JSON.parse(process.env.CI_NEEDS), process.env.CI_DRAFT === 'true')
  } else {
    throw new Error('Usage: node scripts/ci.mjs select|verify')
  }
}
