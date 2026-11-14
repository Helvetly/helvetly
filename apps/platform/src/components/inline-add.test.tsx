import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ApiError } from '@/lib/api'

import { InlineAdd, InlineTextEditor } from './inline-add'

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Add internal ID' }))
  return screen.getByRole('textbox', { name: 'Add internal ID' })
}

test('adds a value in place with Enter', async () => {
  const save = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
  render(<InlineAdd label="Add internal ID" save={save} />)
  const input = await open()
  expect(input).toHaveFocus()
  await userEvent.type(input, '  K-1042 {Enter}')
  expect(save).toHaveBeenCalledExactlyOnceWith('K-1042')
  expect(await screen.findByRole('button', { name: 'Add internal ID' })).toBeVisible()
})

test('Escape and an empty value put the link back without saving', async () => {
  const save = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
  render(<InlineAdd label="Add internal ID" save={save} />)
  await userEvent.type(await open(), 'K-1{Escape}')
  expect(screen.getByRole('button', { name: 'Add internal ID' })).toBeVisible()
  await open()
  await userEvent.tab()
  expect(screen.getByRole('button', { name: 'Add internal ID' })).toBeVisible()
  expect(save).not.toHaveBeenCalled()
})

test('a refused value stays, with the reason', async () => {
  const save = vi.fn<(text: string) => Promise<void>>(() =>
    Promise.reject(new ApiError(422, 'validation_failed', 'This internal ID is already used.')),
  )
  render(<InlineAdd label="Add internal ID" save={save} />)
  const input = await open()
  await userEvent.type(input, 'K-1{Enter}')
  expect(await screen.findByRole('alert')).toHaveTextContent('This internal ID is already used.')
  expect(input).toHaveValue('K-1')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveFocus()
})

test('the input stays focusable while saving', async () => {
  const saving = Promise.withResolvers<void>()
  render(<InlineAdd label="Add internal ID" save={() => saving.promise} />)
  const input = await open()
  await userEvent.type(input, 'K-1{Enter}')
  expect(input).toBeEnabled()
  expect(input).toHaveAttribute('readonly')
  expect(input).toHaveAttribute('aria-busy', 'true')
  expect(input).toHaveFocus()
  saving.resolve()
  expect(await screen.findByRole('button', { name: 'Add internal ID' })).toBeVisible()
})

test('Escape closes only the input inside a sheet; a second Escape closes the sheet', async () => {
  const onOpenChange = vi.fn<(open: boolean) => void>()
  render(
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetTitle>Client</SheetTitle>
        <SheetDescription>Details</SheetDescription>
        <InlineAdd label="Add internal ID" save={() => Promise.resolve()} />
      </SheetContent>
    </Sheet>,
  )
  await userEvent.type(await open(), 'K{Escape}')
  expect(screen.getByRole('button', { name: 'Add internal ID' })).toBeVisible()
  expect(onOpenChange).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
})

const textEditor = (save: (text: string) => Promise<unknown>, onDone = vi.fn<() => void>()) => {
  render(<InlineTextEditor label="Internal ID" initial="K-1" save={save} onDone={onDone} />)
  return { input: screen.getByRole('textbox', { name: 'Internal ID' }), onDone }
}

describe('InlineTextEditor', () => {
  test('starts from the current value and saves the change', async () => {
    const save = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
    const { input, onDone } = textEditor(save)
    expect(input).toHaveValue('K-1')
    expect(input).toHaveFocus()
    await userEvent.type(input, '042{Enter}')
    expect(save).toHaveBeenCalledExactlyOnceWith('K-1042')
    expect(onDone).toHaveBeenCalledOnce()
  })

  test('an unchanged value closes without saving; a cleared one saves empty', async () => {
    const save = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
    const first = textEditor(save)
    await userEvent.type(first.input, '{Enter}')
    expect(save).not.toHaveBeenCalled()
    expect(first.onDone).toHaveBeenCalledOnce()
    cleanup()

    const second = textEditor(save)
    await userEvent.clear(second.input)
    await userEvent.tab()
    expect(save).toHaveBeenCalledExactlyOnceWith('')
  })

  test('multiline keeps Enter for new lines and saves with ⌘Enter', async () => {
    const save = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
    render(<InlineTextEditor label="Note" multiline save={save} onDone={vi.fn<() => void>()} />)
    const textarea = screen.getByRole('textbox', { name: 'Note' })
    await userEvent.type(textarea, 'Pays late{Enter}Call first')
    expect(save).not.toHaveBeenCalled()
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    expect(save).toHaveBeenCalledExactlyOnceWith('Pays late\nCall first')
  })
})
