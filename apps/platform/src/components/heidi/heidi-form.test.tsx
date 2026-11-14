import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { clearHandOff, peekHandOff } from '@/components/import/hand-off'
import type { HeidiForm } from '@/lib/heidi'

import { HeidiFormView } from './heidi-form'

const push = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

afterEach(() => {
  push.mockClear()
  clearHandOff()
})

const form: HeidiForm = {
  id: 'new_client',
  question: 'A few details.',
  fields: [
    { kind: 'choice', name: 'type', label: 'Client type', options: ['Company', 'Person'] },
    { kind: 'multichoice', name: 'tags', label: 'Tags', options: ['VIP', 'Retail', 'Export'] },
  ],
}

test('sends the answers as "Label: value" lines', async () => {
  const onSubmit = vi.fn<(text: string, files: File[]) => void>()
  render(<HeidiFormView form={form} disabled={false} onSubmit={onSubmit} />)

  await userEvent.click(screen.getByRole('radio', { name: 'Company' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'VIP' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Export' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

  expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Client type: Company\nTags: VIP, Export', [])
})

test('an answered form shows its answer and locks', () => {
  render(
    <HeidiFormView
      form={form}
      answer={'Client type: Person\nTags: Retail'}
      disabled={false}
      onSubmit={vi.fn<(text: string, files: File[]) => void>()}
    />,
  )

  expect(screen.getByRole('radio', { name: 'Person' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('radio', { name: 'Person' })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: 'Retail' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  expect(screen.getByText('Answered')).toBeInTheDocument()
})

test('an import form opens the chosen page’s import drawer with the turn’s files', async () => {
  const importForm: HeidiForm = {
    id: 'import',
    question: 'What do these files contain?',
    intent: 'import',
    fields: [
      {
        kind: 'choice',
        name: 'kind',
        label: 'Import as',
        options: ['Clients', 'Products & services'],
      },
    ],
  }
  const file = new File(['name;sku'], 'catalogue.csv', { type: 'text/csv' })
  const onSubmit = vi.fn<(text: string, files: File[]) => void>()
  render(
    <HeidiFormView form={importForm} disabled={false} attachments={[file]} onSubmit={onSubmit} />,
  )

  await userEvent.click(screen.getByRole('radio', { name: 'Products & services' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

  expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Import as: Products & services', [])
  expect(push).toHaveBeenCalledExactlyOnceWith('/products?import=1')
  expect(peekHandOff('products')).toEqual([file])
})

test('a form without the import intent never navigates', async () => {
  render(
    <HeidiFormView
      form={form}
      disabled={false}
      onSubmit={vi.fn<(text: string, files: File[]) => void>()}
    />,
  )
  await userEvent.click(screen.getByRole('radio', { name: 'Company' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(push).not.toHaveBeenCalled()
})
