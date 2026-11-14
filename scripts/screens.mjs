// Screenshots every "Pages/…" story of the built Storybooks (`pnpm build:storybook`) at 1440 light,
// 1440 dark and 390 light: `node scripts/screens.mjs <out-dir>`.
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const { chromium } = createRequire(new URL('../apps/platform/package.json', import.meta.url))(
  'playwright',
)

const out = process.argv[2]
if (!out) {
  console.error('usage: node scripts/screens.mjs <out-dir>')
  process.exit(1)
}
mkdirSync(out, { recursive: true })

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
}
const serve = (root) =>
  new Promise((done) => {
    const server = createServer((request, response) => {
      const path = decodeURIComponent(new URL(request.url, 'http://x').pathname)
      let file = resolve(root, `.${path}`)
      if (!file.startsWith(root) || !existsSync(file)) return response.writeHead(404).end()
      if (statSync(file).isDirectory()) file = join(file, 'index.html')
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      })
      createReadStream(file).pipe(response)
    })
    server.listen(0, '127.0.0.1', () => done(server))
  })

const shots = [
  { suffix: '1440-light', width: 1440, dark: false },
  { suffix: '1440-dark', width: 1440, dark: true },
  { suffix: '390-light', width: 390, dark: false },
]
// Each page story has Light/Dark/Phone variants; the base one is shot in all three settings.
const isBase = (entry) =>
  entry.type === 'story' &&
  entry.title.startsWith('Pages/') &&
  !/(Dark|Phone)$/.test(entry.name.replace(/\s/g, ''))

const browser = await chromium.launch()
let count = 0
for (const app of ['platform', 'portal']) {
  const root = resolve(import.meta.dirname, `../apps/${app}/storybook-static`)
  if (!existsSync(root)) {
    console.error(`skipped ${app}: run pnpm build:storybook first`)
    continue
  }
  const server = await serve(root)
  const base = `http://127.0.0.1:${server.address().port}`
  const index = await (await fetch(`${base}/index.json`)).json()
  for (const story of Object.values(index.entries).filter(isBase)) {
    for (const shot of shots) {
      const page = await browser.newPage({
        viewport: { width: shot.width, height: 900 },
        colorScheme: shot.dark ? 'dark' : 'light',
      })
      // The preview reads `dark` from parameters; `globals` would not reach it, so pick the Dark story.
      const id = shot.dark ? `${story.id}-dark` : story.id
      await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(800) // drawers and charts animate in
      await page.screenshot({ path: join(out, `${story.id}--${shot.suffix}.png`), fullPage: true })
      await page.close()
      count++
    }
  }
  server.close()
}
await browser.close()
console.log(`${count} screenshots in ${out}`)
