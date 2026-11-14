import { addFiles } from './import-files'

const file = (name: string, size = 10) => new File(['x'.repeat(size)], name, { lastModified: 1 })

test('adds new files once, refuses big ones and stops at ten', () => {
  const a = file('a.csv')
  expect(addFiles([a], [a, file('b.csv')]).files.map((entry) => entry.name)).toEqual([
    'a.csv',
    'b.csv',
  ])

  const big = addFiles([], [file('big.pdf', 10 * 1024 * 1024 + 1)])
  expect(big).toEqual({ files: [], note: 'big.pdf is over 10 MB.' })

  const many = addFiles(
    [],
    Array.from({ length: 12 }, (_, index) => file(`${index}.csv`)),
  )
  expect(many.files).toHaveLength(10)
  expect(many.note).toBe('Up to 10 files at a time.')
})
