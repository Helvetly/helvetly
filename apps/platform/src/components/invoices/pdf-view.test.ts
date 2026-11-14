import { pdfProblem } from './pdf-view'

const named = (name: string) => Object.assign(new Error('x'), { name })

test('says what is wrong with a PDF in words, and offers a retry only when it may help', () => {
  expect(pdfProblem(named('InvalidPDFException'))).toMatchObject({
    title: 'This file can’t be opened as a PDF',
    retry: false,
  })
  expect(pdfProblem(named('PasswordException')).title).toMatch(/password/)
  expect(pdfProblem(new TypeError('Failed to fetch')).retry).toBe(true)
})
