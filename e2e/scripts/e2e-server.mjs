import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
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
const env = {
  ...process.env,
  DATABASE_URL: database.toString(),
  HTTP_ADDR: `127.0.0.1:${apiPort}`,
  PUBLIC_URL: `http://localhost:${port}`,
  PORTAL_URL: `http://localhost:${portalPort}`,
  AUTH_DEV_SIGNIN: 'true',
  COOKIE_SECURE: 'false',
  // A real key per run, so the API does not fall back to (and warn about) the fixed development key.
  SECRET_KEY: randomBytes(32).toString('base64'),
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  SMTP_HOST: '',
  STRIPE_SECRET_KEY: '',
  OPENAI_API_KEY: '',
  HELVETLY_E2E_FAKE_AI: 'true',
  // Tests never call the federal register.
  UID_REGISTER_URL: 'off',
  // ...nor the public Photon instance.
  ADDRESS_SUGGEST_URL: 'off',
  STRIPE_WEBHOOK_SECRET: '',
  S3_ENDPOINT: 'http://localhost:9310',
  S3_REGION: 'us-east-1',
  S3_BUCKET: bucket,
  S3_ACCESS_KEY: 'helvetly',
  S3_SECRET_KEY: 'helvetly-secret',
  S3_OBJECT_LOCK_DAYS: '0',
  API_URL: `http://127.0.0.1:${apiPort}`,
  DOCUMENTS_MAX_UPLOAD_MB: '1',
  // Custom portal domains against a fake Cloudflare (scripts/cloudflare-fake.mjs); the tests have no public DNS, so
  // every ownership TXT record is found.
  CLOUDFLARE_API_TOKEN: 'e2e-cloudflare-token',
  CLOUDFLARE_ZONE_ID: cloudflareZone,
  CUSTOM_DOMAIN_TARGET: 'portal.helvetly.com',
  HELVETLY_E2E_FAKE_DOMAINS: 'true',
  // Google and Microsoft calendars served by the API itself (calsync's fake providers): connect, push, outside moves.
  HELVETLY_E2E_FAKE_CALENDARS: 'true',
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
  const cloudflare = await startCloudflareFake()
  env.CLOUDFLARE_API_URL = `http://127.0.0.1:${cloudflare.address().port}`
  await databaseAction('create')
  await finished(run('go', ['build', '-o', binary, './cmd/helvetly'], 'apps/api'))
  const api = run(binary, [], 'apps/api')
  api.once('exit', () => {
    if (!stopping) void stop().finally(() => process.exit(1))
  })
  // Playwright waits for the API through the platform and starts the portal separately.
  const platform = run('pnpm', ['exec', 'next', 'dev', '--port', port], 'apps/platform')
  platform.once('exit', () => {
    if (!stopping) void stop().finally(() => process.exit(1))
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : 'E2E startup failed')
  await stop()
  process.exitCode = 1
}
