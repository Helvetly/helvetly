import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

// Each spec gets a fresh API, schema and bucket. Auth's per-IP limits remain enabled.
// The disposable Postgres and S3 of compose.e2e.yml come up first (a no-op when they already run).
const up = spawnSync('docker', ['compose', '-f', '../compose.e2e.yml', 'up', '-d', '--wait'], {
  stdio: 'inherit',
})
if (up.status !== 0)
  throw new Error('docker compose -f compose.e2e.yml up failed; is Docker running?')
const reports = resolve('test-results/e2e-blobs')
await rm(reports, { recursive: true, force: true })
await mkdir(reports, { recursive: true })
// HELVETLY_E2E_SHARD=i/n runs every n-th spec from the i-th, so CI can spread the specs over parallel jobs.
const [shard, shards] = (process.env.HELVETLY_E2E_SHARD ?? '1/1').split('/').map(Number)
if (!(shards >= 1 && shard >= 1 && shard <= shards))
  throw new Error('HELVETLY_E2E_SHARD must look like 1/2')
const specs = (await readdir('tests'))
  .filter((name) => name.endsWith('.spec.ts'))
  .toSorted()
  .filter((_, index) => index % shards === shard - 1)
let child
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true
    child?.kill(signal)
  })
}
function run(args, env = process.env) {
  return new Promise((resolveExit, reject) => {
    child = spawn('pnpm', ['exec', 'playwright', ...args], { stdio: 'inherit', env })
    child.once('error', reject)
    child.once('exit', (code) => resolveExit(code ?? 1))
  })
}
let failed = false
for (const spec of specs) {
  if (interrupted) break
  const name = spec.replace('.spec.ts', '')
  const code = await run(
    [
      'test',
      `tests/${spec}`,
      '--reporter=list,blob',
      `--output=test-results/${name}`,
      ...process.argv.slice(2),
    ],
    {
      ...process.env,
      PLAYWRIGHT_BLOB_OUTPUT_FILE: resolve(reports, `${name}.zip`),
    },
  )
  if (code !== 0) failed = true
}
if (!interrupted && (await readdir(reports)).length > 0) {
  if (
    (await run(['merge-reports', '--reporter=html', reports], {
      ...process.env,
      PLAYWRIGHT_HTML_OPEN: 'never',
    })) !== 0
  )
    failed = true
}
process.exitCode = failed || interrupted ? 1 : 0
