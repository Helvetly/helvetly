import { describe, expect, it } from 'vitest'

import { checkSameBatch, MAX_REQUEST_BYTES, packFiles } from './upload-packs'

const MB = 1024 * 1024
const sized = (name: string, size: number) =>
  new File([new Uint8Array(size).fill(name.charCodeAt(0))], name)

describe('packFiles', () => {
  it('keeps a batch under the limit in one request', () => {
    const files = [sized('a', 10), sized('b', 20)]
    expect(packFiles(files, 30)).toEqual([files])
  })

  it('starts a new pack before the limit is passed, in order', () => {
    const [a, b, c, d] = [sized('a', 10), sized('b', 15), sized('c', 10), sized('d', 30)]
    expect(packFiles([a, b, c, d], 30)).toEqual([[a, b], [c], [d]])
  })

  it('sends ten 20 MB files in packs of at most 95 MB (scaled down to bytes)', () => {
    const files = Array.from({ length: 10 }, (_, i) => sized(`${i}`, 20))
    expect(packFiles(files, 95).map((pack) => pack.length)).toEqual([4, 4, 2])
  })

  it('stays under Cloudflare’s 100 MB with room for the multipart framing', () => {
    expect(MAX_REQUEST_BYTES).toBe(95 * MB)
    expect(MAX_REQUEST_BYTES + 64 * 1024).toBeLessThan(100_000_000)
  })

  it('sends nothing for no files', () => {
    expect(packFiles([])).toEqual([])
  })
})

describe('checkSameBatch', () => {
  it('refuses identical bytes in different packs with the server message', async () => {
    const first = new File(['same'], 'first.pdf')
    const renamed = new File(['same'], 'renamed.pdf')
    await expect(checkSameBatch([[first], [sized('x', 4)], [renamed]])).rejects.toMatchObject({
      status: 409,
      code: 'duplicate_file',
      message: 'renamed.pdf contains the same file as first.pdf.',
    })
  })

  it('accepts equal sizes with different bytes', async () => {
    await expect(
      checkSameBatch([[new File(['abcd'], 'a.pdf')], [new File(['abce'], 'b.pdf')]]),
    ).resolves.toBeUndefined()
  })

  it('leaves a single request to the server', async () => {
    const same = new File(['same'], 'a.pdf')
    await expect(checkSameBatch([[same, same]])).resolves.toBeUndefined()
  })
})
