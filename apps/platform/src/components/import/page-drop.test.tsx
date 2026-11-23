import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearHandOff, peekHandOff } from './hand-off'
import { nextDragDepth, useFileDrop, useImportDrop } from './page-drop'

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
function drag(type: string, files: File[] = [], types = ['Files'], relatedTarget?: null) {
  const event = new Event(type, { cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types, files } })
  if (relatedTarget === null) Object.defineProperty(event, 'relatedTarget', { value: null })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

describe('nextDragDepth', () => {
  it.each([
    [0, 'enter', 1],
    [1, 'enter', 2],
    [2, 'leave', 1],
    [0, 'leave', 0],
    [0, 'over', 1],
    [3, 'over', 3],
    [3, 'reset', 0],
  ] as const)('%i after %s is %i', (depth, signal, next) => {
    expect(nextDragDepth(depth, signal)).toBe(next)
  })
})

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

  it.each([
    ['drag end', () => drag('dragend')],
    [
      'Escape',
      () => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))),
    ],
    ['window blur', () => act(() => void window.dispatchEvent(new Event('blur')))],
    [
      'a hidden tab',
      () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
        act(() => void document.dispatchEvent(new Event('visibilitychange')))
      },
    ],
  ])('resets on %s, however many enters came first', (_, end) => {
    const { result } = renderHook(() => useFileDrop(true, vi.fn()))
    drag('dragenter')
    drag('dragenter')
    expect(result.current).toBe(true)
    end()
    expect(result.current).toBe(false)
  })

  it('resets when the files leave the window, unless a dragover follows', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useFileDrop(true, vi.fn()))
      drag('dragenter')
      drag('dragenter')
      drag('dragleave', [], ['Files'], null)
      drag('dragover')
      act(() => void vi.advanceTimersByTime(500))
      expect(result.current).toBe(true)

      drag('dragleave', [], ['Files'], null)
      act(() => void vi.advanceTimersByTime(500))
      expect(result.current).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows on a dragover even when the enter was missed, and prevents the browser opening the file', () => {
    const { result } = renderHook(() => useFileDrop(true, vi.fn()))
    expect(drag('dragover').defaultPrevented).toBe(true)
    expect(result.current).toBe(true)
  })

  it('leaves a drop an inner target stopped to that target, but still resets and prevents it', () => {
    const onFiles = vi.fn<(files: File[]) => void>()
    const { result } = renderHook(() => useFileDrop(true, onFiles))
    const inner = document.createElement('div')
    document.body.append(inner)
    inner.addEventListener('drop', (event) => event.stopPropagation())
    drag('dragenter')
    const event = new Event('drop', { cancelable: true, bubbles: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [] } })
    act(() => void inner.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(result.current).toBe(false)
    expect(onFiles).not.toHaveBeenCalled()
    inner.remove()
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
