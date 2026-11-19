import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { detectChecks, pushRunPassed, selectChecks, verifyResults } from './ci.mjs'

const full = { backend: true, frontend: true, e2e: true, build: true }
const docs = { backend: false, frontend: false, e2e: false, build: false }
const frontend = { ...full, backend: false }
const backend = { ...full, frontend: false }

test('change selection follows application dependencies and defaults to full CI', () => {
  for (const [paths, expected] of [
    [['README.md', 'docs/invoices-contract.md'], docs],
    [['apps/platform/src/app/page.tsx'], frontend],
    [['apps/portal/src/app/page.tsx'], frontend],
    [['packages/ui/src/components/button.tsx'], frontend],
    [['apps/web/src/app/page.tsx'], { ...frontend, e2e: false }],
    [['apps/web/content/legal/terms.md', 'apps/web/src/lib/legal.ts'], { ...frontend, e2e: false }],
    [['apps/web/next.config.ts'], full],
    [['apps/web/content/legal/privacy-policy.md'], { ...frontend, e2e: false }],
    [['apps/web/content/legal/privacy-policy.md', 'CONTRIBUTING.md'], { ...frontend, e2e: false }],
    [['apps/api/internal/auth/auth.go'], backend],
    [['apps/api/internal/einvoice/ubl.go'], backend],
    [['apps/api/internal/vatreturn/xml.go'], backend],
    [['apps/api/internal/heidi/guide.md'], backend],
    [['apps/api/internal/store/migrations/099.sql'], full],
    [['apps/api/internal/einvoice/testdata/fa3.xsd'], full],
    [['pnpm-lock.yaml'], full],
    [['apps/api/go.sum'], full],
    [['packages/typescript-config/base.json'], full],
    [['packages/vitest-config/src/index.ts'], full],
    [['apps/platform/next.config.ts'], full],
    [['.github/workflows/ci.yml'], full],
    [['.github/workflows/release.yml', '.github/workflows/cancel-closed-pr.yml'], docs],
    [['.github/workflows/docs.yml'], full],
    [['scripts/check-links.mjs'], full],
    [['apps/web/next.config.ts'], full],
    [['.github/workflows/standards.yml'], full],
    [['scripts/standards.sh'], full],
    [['.env.example'], full],
    [['e2e/tests/journeys.spec.ts'], { ...docs, e2e: true }],
    [['unknown/path'], full],
    [['docs/schema.json'], full],
    [['apps/api/internal/auth/auth.go', 'apps/platform/src/lib/api.ts'], full],
    [[], full],
  ])
    assert.deepEqual(selectChecks(paths), expected, paths.join(', '))
})

test('PR diff includes older commits, deletions and both sides of a rename; errors run full CI', () => {
  const root = join(tmpdir(), 'helvetly')
  mkdirSync(root, { recursive: true })
  const cwd = mkdtempSync(join(root, 'ci-selection-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const write = (path, content) => {
    mkdirSync(join(cwd, path, '..'), { recursive: true })
    writeFileSync(join(cwd, path), content)
  }
  try {
    git('init', '-q')
    git('config', 'user.name', 'CI fixture')
    git('config', 'user.email', 'ci@example.invalid')
    write('apps/platform/src/page.tsx', 'original')
    git('add', '.')
    git('commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    const event = { action: 'synchronize', pull_request: { base: { sha: base }, draft: false } }
    git('rm', '-q', 'apps/platform/src/page.tsx')
    git('commit', '-qm', 'delete frontend file')
    assert.deepEqual(detectChecks('pull_request', event, git('rev-parse', 'HEAD'), cwd), frontend)
    write('docs/moved.md', 'original')
    git('add', '.')
    git('commit', '-qm', 'documentation follow-up')
    const head = git('rev-parse', 'HEAD')
    assert.deepEqual(detectChecks('pull_request', event, head, cwd), frontend)
    assert.deepEqual(
      detectChecks('pull_request', { ...event, action: 'ready_for_review' }, head, cwd),
      full,
    )
    for (const name of ['push', 'workflow_dispatch', 'merge_group', 'unrecognised'])
      assert.deepEqual(detectChecks(name, event, head, cwd), full)
    // A push is scoped by its whole range, only when the previous main commit's run passed.
    const push = { before: base, forced: false }
    assert.deepEqual(detectChecks('push', push, head, cwd, true), frontend)
    assert.deepEqual(detectChecks('push', push, head, cwd, false), full)
    assert.deepEqual(detectChecks('push', { ...push, forced: true }, head, cwd, true), full)
    assert.deepEqual(
      detectChecks('push', { ...push, before: '0'.repeat(40) }, head, cwd, true),
      full,
    )
    assert.deepEqual(detectChecks('push', {}, head, cwd, true), full)
    assert.deepEqual(detectChecks('workflow_dispatch', push, head, cwd, true), full)
    assert.deepEqual(detectChecks('pull_request', event, 'a'.repeat(40), cwd), full)
    // A base that is not in the repository (force-pushed away, squashed history) runs full CI.
    const gone = 'c'.repeat(40)
    assert.deepEqual(detectChecks('push', { before: gone, forced: false }, head, cwd, true), full)
    assert.deepEqual(
      detectChecks('pull_request', { ...event, pull_request: { base: { sha: gone } } }, head, cwd),
      full,
    )
    assert.deepEqual(detectChecks('pull_request', {}, head, cwd), full)
    const output = join(cwd, 'selection')
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL('./ci.mjs', import.meta.url)), 'select'],
      {
        cwd,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: join(cwd, 'missing-event.json'),
          GITHUB_OUTPUT: output,
        },
        stdio: 'pipe',
      },
    )
    assert.equal(
      readFileSync(output, 'utf8'),
      'backend=true\nfrontend=true\ne2e=true\nbuild=true\n',
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

const verifiedSha = 'b'.repeat(40)
const reply = (status, body) => async (url, init) => {
  assert.match(url, /actions\/workflows\/ci\.yml\/runs\?event=push&head_sha=b{40}/)
  assert.equal(init.headers.authorization, 'Bearer token')
  return new Response(JSON.stringify(body), { status })
}
const pushRuns = (...conclusions) => ({
  workflow_runs: conclusions.map((conclusion) => ({ conclusion })),
})
const passed = (request) => pushRunPassed('Helvetly/helvetly', verifiedSha, 'token', request)
const unreachable = async () => {
  throw new Error('offline')
}

test('a previous main commit counts as verified only when its CI run passed', async () => {
  assert.equal(await passed(reply(200, pushRuns('success'))), true)
  for (const body of [pushRuns(), pushRuns('failure', 'cancelled', null), {}])
    assert.equal(await passed(reply(200, body)), false)
  assert.equal(await passed(reply(403, {})), false)
  assert.equal(await passed(unreachable), false)
  for (const [repository, commit, token] of [
    ['Helvetly/helvetly', verifiedSha, ''],
    ['Helvetly/helvetly', '0', 'token'],
    ['not a repository', verifiedSha, 'token'],
  ])
    assert.equal(await pushRunPassed(repository, commit, token, unreachable), false)
})

function results(checks) {
  return {
    changes: {
      result: 'success',
      outputs: Object.fromEntries(
        Object.entries(checks).map(([key, value]) => [key, String(value)]),
      ),
    },
    quick: { result: 'success' },
    ...Object.fromEntries(
      Object.entries({
        static: checks.build,
        go: checks.backend,
        einvoice: checks.backend,
        vitest: checks.frontend,
        coverage: checks.frontend,
        visual: checks.frontend,
        e2e: checks.e2e,
      }).map(([job, selected]) => [job, { result: selected ? 'success' : 'skipped' }]),
    ),
  }
}

test('required gate rejects drafts, missing selection and every failed, cancelled or skipped required job', () => {
  for (const checks of [full, docs, frontend, backend]) verifyResults(results(checks), false)
  assert.throws(() => verifyResults(results(docs), true), /Draft PR/)
  for (const job of Object.keys(results(full))) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const needs = results(full)
      needs[job].result = result
      assert.throws(() => verifyResults(needs, false), undefined, `${job}: ${result}`)
    }
  }
  assert.throws(
    () => verifyResults({ ...results(full), lighthouse: { result: 'failure' } }, false),
    /lighthouse: not checked/,
  )
  const needs = results(docs)
  delete needs.changes.outputs.backend
  assert.throws(() => verifyResults(needs, false), /Missing selection/)
})

test('workflow keeps event transitions, shards, permissions and expensive jobs behind the quick gate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  for (const event of [
    'synchronize',
    'ready_for_review',
    'converted_to_draft',
    'workflow_dispatch:',
    'merge_group:',
  ])
    assert.ok(workflow.includes(event), event)
  // Only PR runs are cancelled by a newer commit; every other run has a group of its own.
  assert.match(workflow, /cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/)
  assert.match(workflow, /format\('ci-run-\{0\}', github.run_id\)/)
  assert.match(workflow, /actions: read/)
  // Chromium's system libraries come with the runner image; apt runs only when the browser cannot start.
  assert.doesNotMatch(workflow, /install --with-deps/)
  assert.match(
    workflow,
    /chromium.launch\(\)[^\n]*\|\|\n\s+timeout 240 [^\n]*install-deps chromium/,
  )
  // PRs restore the Go cache, never save it.
  assert.equal(workflow.match(/^\s+- \*go-cache-restore\n\s+- \*go-cache$/gm)?.length, 3)
  assert.match(workflow, /permissions:\n  contents: read/)
  assert.doesNotMatch(workflow, /pull_request_target|continue-on-error|paths-ignore:/)
  for (const job of ['static', 'go', 'einvoice', 'vitest', 'visual', 'e2e']) {
    const section = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z]+:\n/)[0]
    assert.match(section ?? '', /needs: \[changes, quick\]/, job)
    assert.match(section ?? '', /!github.event.pull_request.draft/, job)
  }
  assert.match(workflow, /coverage:\n[\s\S]*?needs: \[changes, quick, vitest\]/)
  assert.match(workflow, /required:\n[\s\S]*?if: \$\{\{ always\(\) \}\}/)
  assert.equal(workflow.match(/shard: \['1\/2', '2\/2'\]/g)?.length, 1)
  assert.equal(workflow.match(/shard: \['1\/3', '2\/3', '3\/3'\]/g)?.length, 1)
  assert.equal(workflow.match(/shard: \['1\/5', '2\/5', '3\/5', '4\/5', '5\/5'\]/g)?.length, 2)
  const api = JSON.parse(readFileSync(new URL('../apps/api/package.json', import.meta.url), 'utf8'))
  assert.ok(
    workflow.includes(`run: ${api.scripts['test:xsd']}`),
    'XML command must match the local gate',
  )
})

const workflowDir = new URL('../.github/workflows/', import.meta.url)

test('every action in every workflow is pinned by commit SHA, and checkouts drop the token', () => {
  for (const name of readdirSync(workflowDir)) {
    const workflow = readFileSync(new URL(name, workflowDir), 'utf8')
    for (const line of workflow.match(/^\s*(?:- )?uses: .+/gm) ?? [])
      assert.match(line, /@[0-9a-f]{40} # v\d+\.\d+\.\d+/, `${name}: ${line}`)
    for (const checkout of workflow.match(
      /uses: actions\/checkout@.+\n(?:\s+with:\n(?:\s{10,}.+\n)+)?/g,
    ) ?? [])
      assert.match(checkout, /persist-credentials: false/, `${name}: ${checkout}`)
  }
})

test("CI required waits for every other job, and the e-invoice tool cache is the script's", () => {
  const workflow = readFileSync(new URL('ci.yml', workflowDir), 'utf8')
  const jobs = [...workflow.split('\njobs:\n')[1].matchAll(/^  ([a-z0-9-]+):$/gm)].map((m) => m[1])
  const needs = workflow.match(/\n  required:\n[\s\S]*?needs: \[([^\]]+)\]/)[1].split(', ')
  assert.deepEqual(needs.toSorted(), jobs.filter((job) => job !== 'required').toSorted())
  const script = readFileSync(new URL('validate-einvoice.sh', import.meta.url), 'utf8')
  assert.match(script, /artifact_root="\$\{TMPDIR:-\/tmp\}\/helvetly"/)
  assert.match(script, /tool_cache="\$artifact_root\/einvoice-tools"/)
  assert.match(workflow, /path: \$\{\{ runner.temp \}\}\/helvetly\/einvoice-tools\n/)
  assert.match(workflow, /TMPDIR: \$\{\{ runner.temp \}\}/)
})

const workflows = readdirSync(workflowDir).map((name) => ({
  name,
  text: readFileSync(new URL(name, workflowDir), 'utf8'),
}))

// The only tokens beyond the run's own: one that starts Helvetly/infra's deploy with a tag, one that writes CLA
// signatures. Production credentials live in the private deployment repository.
const allowedSecrets = {
  'release.yml': ['secrets.DEPLOY_DISPATCH_TOKEN'],
  'cla.yml': ['secrets.CLA_SIGNATURES_TOKEN'],
}

test('the public workflows use no long-lived secret but the dispatch and CLA tokens, and deploy nothing', () => {
  for (const { name, text } of workflows) {
    for (const ref of text.match(/secrets\.[A-Za-z_]+/g) ?? [])
      assert.ok(
        ['secrets.GITHUB_TOKEN', ...(allowedSecrets[name] ?? [])].includes(ref),
        `${name}: ${ref}`,
      )
    assert.doesNotMatch(text, /secrets: inherit|repository_dispatch|wrangler|doctl|ssh /, name)
    // Every workflow states its token's permissions; none asks for all of them.
    assert.match(text, /\npermissions:(?: \{\}|\n {2}[a-z-]+: (read|write))\n/, name)
    assert.doesNotMatch(text, /write-all/, name)
  }
})

test('releases are built from v<semver> tags only, never overwritten, attested to the commit', () => {
  const release = workflows.find((w) => w.name === 'release.yml')?.text ?? ''
  assert.match(release, /on:\n {2}push:\n {4}tags: \['v\*'\]\n/)
  assert.doesNotMatch(release, /pull_request|workflow_dispatch|branches:/)
  assert.match(release, /merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/)
  assert.match(release, /already exists/)
  assert.match(release, /org\.opencontainers\.image\.revision=\$GITHUB_SHA/)
  assert.match(release, /packages: write/)
  assert.match(release, /attestations: write/)
})

test("run cancellation targets the closed pull request's own commit", () => {
  const cancel = readFileSync(
    new URL('../.github/workflows/cancel-closed-pr.yml', import.meta.url),
    'utf8',
  )
  assert.match(cancel, /types: \[closed\]/)
  assert.match(cancel, /--workflow ci.yml/)
  assert.match(cancel, /--commit "\$HEAD_SHA"/)
  assert.doesNotMatch(cancel, /--branch/)
  assert.match(cancel, /timeout-minutes/)
})

test('the Storybook MSW workers never unregister themselves, never hold an event open, and match the installed msw', () => {
  const require = createRequire(import.meta.url)
  for (const app of ['platform', 'portal']) {
    const worker = readFileSync(
      new URL(`../apps/${app}/.storybook/msw/mockServiceWorker.js`, import.meta.url),
      'utf8',
    )
    // `msw init` restores self-unregistration, which made a random story file lose its mocks.
    assert.doesNotMatch(worker, /registration\.unregister\(\)/, app)
    assert.match(worker, /Helvetly: no self-unregistration/, app)
    // It also restores replies that wait on a MessagePort the msw client never answers; Chrome kills a worker whose
    // event stays open 5 minutes, which failed a random story mid-run.
    assert.doesNotMatch(
      worker,
      /await sendToClient\(client, \{\s+type: '(CLIENT_CLOSED|KEEPALIVE_RESPONSE|INTEGRITY_CHECK_RESPONSE|MOCKING_ENABLED)'/,
      app,
    )
    assert.match(worker, /case 'UNANSWERED'/, app)
    const msw = require(
      require.resolve('msw/package.json', {
        paths: [fileURLToPath(new URL(`../apps/${app}`, import.meta.url))],
      }),
    )
    assert.match(
      worker,
      new RegExp(`PACKAGE_VERSION = '${msw.version.replaceAll('.', '\\.')}'`),
      app,
    )
  }
})
