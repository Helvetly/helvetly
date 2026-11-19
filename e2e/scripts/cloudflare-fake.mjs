// A stand-in for Cloudflare's custom hostnames API (one zone), for the custom portal domain specs: a hostname is
// pending when created and active, with its certificate, once it has been read again.
import { createServer } from 'node:http'

export const cloudflareZone = '0123456789abcdef0123456789abcdef'

function answer(res, status, result) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ success: status < 300, errors: [], result }))
}

export function startCloudflareFake(port) {
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
        const id = `cf_${hosts.size + 1}`
        hosts.set(id, {
          id,
          hostname,
          status: 'pending',
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
      if (req.method === 'GET' && url.pathname === base)
        return answer(res, 200, [...hosts.values()])
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
  server.listen(port, '127.0.0.1')
  return server
}
