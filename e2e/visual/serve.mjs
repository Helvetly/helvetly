// Serves the built Storybooks (`pnpm build:storybook`) for the visual suite: platform on 6611, portal on 6612.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

for (const [app, port] of [
  ['platform', 6611],
  ['portal', 6612],
]) {
  const root = resolve(import.meta.dirname, `../../apps/${app}/storybook-static`)
  if (!existsSync(join(root, 'index.json'))) {
    console.error(`visual: ${root} is missing; run pnpm build:storybook first`)
    process.exit(1)
  }
  createServer((request, response) => {
    let file = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://x').pathname)}`)
    if (!file.startsWith(root) || !existsSync(file)) return response.writeHead(404).end()
    if (statSync(file).isDirectory()) file = join(file, 'index.html')
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(response)
  }).listen(port, '127.0.0.1')
}
