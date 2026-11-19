import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cloudflareZone, startCloudflareFake } from './cloudflare-fake.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const schema = `helvetly_e2e_${process.pid}_${randomUUID().replaceAll('-', '')}`
const bucket = schema.replaceAll('_', '-')
const binary = join(tmpdir(), `helvetly-e2e-${process.pid}`)
// The disposable services of compose.e2e.yml, never the development database or bucket.
const database = new URL('postgres://helvetly:helvetly@localhost:5434/helvetly?sslmode=disable')
database.searchParams.set('search_path', schema)
const apiPort = '3338'
const port = '8008'
const portalPort = '8009'
const cloudflarePort = '3339'
const env = {
  ...process.env,
  DATABASE_URL: database.toString(),
  HTTP_ADDR: `127.0.0.1:${apiPort}`,
  PUBLIC_URL: `http://localhost:${port}`,
  PORTAL_URL: `http://localhost:${portalPort}`,
  AUTH_DEV_SIGNIN: 'true',
  COOKIE_SECURE: 'false',
  SECRET_KEY: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  SMTP_HOST: '',
  STRIPE_SECRET_KEY: '',
  OPENAI_API_KEY: '',
  HELVETLY_E2E_FAKE_AI: 'true',
  // Tests never call the federal register.
  UID_REGISTER_URL: 'off',
  STRIPE_WEBHOOK_SECRET: '',
  S3_ENDPOINT: 'http://localhost:9310',
  S3_REGION: 'us-east-1',
  S3_BUCKET: bucket,
  S3_ACCESS_KEY: 'helvetly',
  S3_SECRET_KEY: 'helvetly-secret',
  S3_OBJECT_LOCK_DAYS: '0',
  API_URL: `http://127.0.0.1:${apiPort}`,
  DOCUMENTS_MAX_UPLOAD_MB: '1',
  // Custom portal domains against a fake Cloudflare (scripts/cloudflare-fake.mjs).
  CLOUDFLARE_API_TOKEN: 'e2e-cloudflare-token',
  CLOUDFLARE_ZONE_ID: cloudflareZone,
  CUSTOM_DOMAIN_TARGET: 'portal.helvetly.com',
  CLOUDFLARE_API_URL: `http://127.0.0.1:${cloudflarePort}`,
  NEXT_TELEMETRY_DISABLED: '1',
  HELVETLY_E2E_NEXT_DIST: 'true',
}
const processes = []
let stopping = false
const run = (cmd, args, cwd) => {
  const child = spawn(cmd, args, { cwd: join(root, cwd), env, stdio: 'inherit' })
  processes.push(child)
  return child
}
const finished = (child) =>
  new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('E2E subprocess failed')),
    )
  })
const databaseAction = (action) =>
  finished(run('go', ['run', './cmd/e2e-db', action, schema], 'apps/api'))

async function stop() {
  if (stopping) return
  stopping = true
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM')
  await Promise.all(
    processes
      .filter((child) => child.exitCode === null)
      .map((child) => finished(child).catch(() => {})),
  )
  await rm(binary, { force: true })
  await databaseAction('drop')
}
process.on('SIGTERM', () => void stop().finally(() => process.exit()))
process.on('SIGINT', () => void stop().finally(() => process.exit()))

try {
  const cloudflare = startCloudflareFake(Number(cloudflarePort))
  process.once('exit', () => cloudflare.close())
  await databaseAction('create')
  await finished(run('go', ['build', '-o', binary, './cmd/helvetly'], 'apps/api'))
  const api = run(binary, [], 'apps/api')
  api.once('exit', () => {
    if (!stopping) void stop().finally(() => process.exit(1))
  })
  let ready = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (stopping) break
    try {
      ready = (await fetch(`http://127.0.0.1:${apiPort}/api/v1/auth/config`)).ok
    } catch {
      ready = false
    }
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('The isolated E2E API did not become ready')
  const platform = run('pnpm', ['exec', 'next', 'dev', '--port', port], 'apps/platform')
  platform.once('exit', () => {
    if (!stopping) void stop().finally(() => process.exit(1))
  })
  const portal = run('pnpm', ['exec', 'next', 'dev', '--port', portalPort], 'apps/portal')
  portal.once('exit', () => {
    if (!stopping) void stop().finally(() => process.exit(1))
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : 'E2E startup failed')
  await stop()
  process.exitCode = 1
}
