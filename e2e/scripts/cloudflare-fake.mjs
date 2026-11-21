// A stand-in for Cloudflare's custom hostnames API (one zone), for the custom portal domain specs: a hostname is
// pending when created and active, with its certificate, once it has been read or refreshed again. Lists page like
// Cloudflare's: at most 50 a page, with result_info.
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'

export const cloudflareZone = '0123456789abcdef0123456789abcdef'

function answer(res, status, result, resultInfo) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ success: status < 300, errors: [], result, result_info: resultInfo }))
}

function page(res, url, hosts) {
  const all = [...hosts.values()].filter(
    (h) => !url.searchParams.get('hostname') || h.hostname === url.searchParams.get('hostname'),
  )
  const perPage = Math.min(Math.max(Number(url.searchParams.get('per_page')) || 20, 5), 50)
  const n = Math.max(Number(url.searchParams.get('page')) || 1, 1)
  const result = all.slice((n - 1) * perPage, n * perPage)
  return answer(res, 200, result, {
    page: n,
    per_page: perPage,
    count: result.length,
    total_count: all.length,
    total_pages: Math.ceil(all.length / perPage),
  })
}

export async function startCloudflareFake() {
  const hosts = new Map()
  const base = `/zones/${cloudflareZone}/custom_hostnames`
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake')
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer e2e-cloudflare-token') return answer(res, 403, null)
      if (req.method === 'POST' && url.pathname === base) {
        const { hostname } = JSON.parse(body)
        if ([...hosts.values()].some((h) => h.hostname === hostname)) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          return res.end(
            JSON.stringify({
              success: false,
              errors: [{ code: 1406, message: 'Duplicate custom hostname found.' }],
              result: null,
            }),
          )
        }
        const id = randomUUID()
        hosts.set(id, {
          id,
          hostname,
          status: 'pending',
          created_at: new Date().toISOString(),
          ssl: { status: 'initializing', validation_records: [] },
          ownership_verification: {
            type: 'txt',
            name: `_cf-custom-hostname.${hostname}`,
            value: `token-${id}`,
          },
          verification_errors: [],
        })
        return answer(res, 200, hosts.get(id))
      }
      if (req.method === 'GET' && url.pathname === base) return page(res, url, hosts)
      const host = hosts.get(url.pathname.slice(base.length + 1))
      if (!host) return answer(res, 404, null)
      if (req.method === 'DELETE') {
        hosts.delete(host.id)
        return answer(res, 200, { id: host.id })
      }
      Object.assign(host, { status: 'active', ssl: { status: 'active' } })
      return answer(res, 200, host)
    })
  })
  await once(server.listen(0, '127.0.0.1'), 'listening')
  return server.unref()
}
