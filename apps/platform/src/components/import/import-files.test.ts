import { addFiles } from './import-files'

const file = (name: string, size = 10) => new File(['x'.repeat(size)], name, { lastModified: 1 })

test('adds new files once, refuses big ones and stops at 25', () => {
  const a = file('a.csv')
  expect(addFiles([a], [a, file('b.csv')]).files.map((entry) => entry.name)).toEqual([
    'a.csv',
    'b.csv',
  ])

  const big = addFiles([], [file('big.pdf', 25 * 1024 * 1024 + 1)])
  expect(big).toEqual({ files: [], note: 'big.pdf is over 25 MB.' })

  const many = addFiles(
    [],
    Array.from({ length: 27 }, (_, index) => file(`${index}.csv`)),
  )
  expect(many.files).toHaveLength(25)
  expect(many.note).toBe('Up to 25 files at a time.')
})

test('keeps one import request under 95 MB, under Cloudflare’s 100 MB', () => {
  const nine = Array.from({ length: 9 }, (_, index) => file(`${index}.pdf`, 10 * 1024 * 1024))
  const full = addFiles(nine, [file('last.pdf', 5 * 1024 * 1024 + 1)])
  expect(full).toEqual({ files: nine, note: 'last.pdf would take the upload over 95 MB.' })
  expect(addFiles(nine, [file('last.pdf', 5 * 1024 * 1024)]).files).toHaveLength(10)
})
