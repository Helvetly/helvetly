import { clearHandOff, handOffImport, peekHandOff } from './hand-off'

afterEach(clearHandOff)

test('hands files to the drawer of the chosen kind only, until cleared', () => {
  const file = new File(['a'], 'clients.csv')
  handOffImport('clients', [file])

  expect(peekHandOff('products')).toEqual([])
  expect(peekHandOff('clients')).toEqual([file])
  expect(peekHandOff('clients')).toEqual([file])

  clearHandOff()
  expect(peekHandOff('clients')).toEqual([])
})

test('a hand-off without files leaves nothing behind', () => {
  handOffImport('clients', [new File(['a'], 'a.csv')])
  handOffImport('products', [])
  expect(peekHandOff('clients')).toEqual([])
  expect(peekHandOff('products')).toEqual([])
})
