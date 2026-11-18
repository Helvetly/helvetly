import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearHandOff, peekHandOff } from './hand-off'
import { useFileDrop, useImportDrop } from './page-drop'

const query = vi.hoisted(() => ({ current: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/clients',
  useSearchParams: () => query.current,
}))

afterEach(() => {
  clearHandOff()
  query.current = new URLSearchParams()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

/** A window drag event carrying `files` the way a desktop drag does (type "Files"). */
function drag(type: string, files: File[] = [], types = ['Files']) {
  const event = new Event(type, { cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types, files } })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

describe('useFileDrop', () => {
  it('shows while files hover the window, through nested enters, and hands over the drop', () => {
    const onFiles = vi.fn<(files: File[]) => void>()
    const { result } = renderHook(() => useFileDrop(true, onFiles))
    expect(result.current).toBe(false)

    drag('dragenter')
    drag('dragenter')
    expect(result.current).toBe(true)
    drag('dragleave')
    expect(result.current).toBe(true)
    expect(drag('dragover').defaultPrevented).toBe(true)

    const file = new File(['a'], 'a.pdf', { type: 'application/pdf' })
    const dropped = drag('drop', [file])
    expect(dropped.defaultPrevented).toBe(true)
    expect(result.current).toBe(false)
    expect(onFiles).toHaveBeenCalledWith([file])
  })

  it('ignores drags without files, such as selected text', () => {
    const onFiles = vi.fn<(files: File[]) => void>()
    const { result } = renderHook(() => useFileDrop(true, onFiles))
    drag('dragenter', [], ['text/plain'])
    expect(result.current).toBe(false)
    expect(drag('drop', [], ['text/plain']).defaultPrevented).toBe(false)
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('does nothing while disabled', () => {
    const onFiles = vi.fn<(files: File[]) => void>()
    const { result } = renderHook(() => useFileDrop(false, onFiles))
    drag('dragenter')
    expect(result.current).toBe(false)
    expect(drag('drop', [new File(['a'], 'a.pdf')]).defaultPrevented).toBe(false)
    expect(onFiles).not.toHaveBeenCalled()
  })
})

describe('useImportDrop', () => {
  it('hands the dropped files to the kind’s import drawer and opens it', () => {
    renderHook(() => useImportDrop('clients', true))
    const file = new File(['a'], 'clients.csv', { type: 'text/csv' })
    drag('drop', [file])
    expect(peekHandOff('clients')).toEqual([file])
    expect(new URL(window.location.href).searchParams.get('import')).toBe('1')
  })

  it('leaves HEIC photos out with a toast, and opens nothing when no file is left', () => {
    const error = vi.spyOn(toast, 'error').mockReturnValue('')
    renderHook(() => useImportDrop('products', true))
    drag('drop', [new File(['a'], 'IMG_0042.HEIC')])
    expect(error).toHaveBeenCalledOnce()
    expect(peekHandOff('products')).toEqual([])
    expect(new URL(window.location.href).searchParams.get('import')).toBeNull()
  })

  it('is off while the import drawer is already open', () => {
    query.current = new URLSearchParams('import=1')
    const { result } = renderHook(() => useImportDrop('clients', true))
    drag('dragenter')
    expect(result.current).toBe(false)
    drag('drop', [new File(['a'], 'a.csv')])
    expect(peekHandOff('clients')).toEqual([])
  })
})
