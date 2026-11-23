'use client'
import { usePathname, useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'

import { featureLock, PLANS_HREF, toastLocked } from '@/components/billing/feature-lock'
import { addFiles as addImportFiles } from '@/components/import/import-files'
import { useAI } from '@/lib/ai'
import { useBilling } from '@/lib/billing'
import { chatReadable, importable, type HeidiPage } from '@/lib/heidi'
import { translate } from '@/lib/i18n'
import { useShortcut } from '@/lib/shortcuts'

import { useHeidiChat, type HeidiChat } from './use-heidi'

/** The page Heidi is asked from, and how to name it in a sentence. */
const PAGES: Record<string, [HeidiPage, string]> = {
  '': ['dashboard', translate('yourDashboard')],
  clients: ['clients', translate('yourClients')],
  invoices: ['invoices', translate('yourInvoices')],
  expenses: ['expenses', translate('yourExpenses2')],
  engagements: ['engagements', translate('yourEngagements')],
  documents: ['documents', translate('yourDocuments')],
  products: ['products', translate('yourProductsAndServices')],
  members: ['members', translate('yourTeam')],
  books: ['settings', translate('yourBooks')],
  settings: ['settings', translate('yourSettings')],
  'settings/billing': ['billing', translate('yourPlanAndBilling')],
}

export function pageOf(pathname: string): { page: HeidiPage; name: string } {
  const [, section = '', sub = ''] = pathname.split('/')
  const [page, name] = PAGES[`${section}/${sub}`] ??
    PAGES[section] ?? ['dashboard', translate('yourDashboard')]
  return { page, name }
}

const STORAGE = 'helvetly:heidi:panel'
export const MIN_WIDTH = 320
const DEFAULT_WIDTH = 420

type PanelState = { open: boolean; width: number }

function loadPanel(): PanelState {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? 'null')
    if (typeof stored === 'object' && stored !== null) {
      const { open, width } = stored as Record<string, unknown>
      return {
        // On phones Heidi is a full-screen sheet: it never reopens by itself on load.
        open: open === true && window.matchMedia('(min-width: 768px)').matches,
        width: typeof width === 'number' ? width : DEFAULT_WIDTH,
      }
    }
  } catch {}
  return { open: false, width: DEFAULT_WIDTH }
}

type HeidiContextValue = {
  open: boolean
  max: boolean
  width: number
  page: HeidiPage
  draft: string
  files: File[]
  chat: HeidiChat
  setOpen: (open: boolean) => void
  setMax: (max: boolean) => void
  setWidth: (width: number) => void
  setDraft: (draft: string) => void
  addFiles: (files: File[]) => void
  removeFile: (file: File) => void
  clearFiles: () => void
  /** Opens the panel, optionally with a question ready in the composer. */
  ask: (prompt?: string) => void
}

const HeidiContext = createContext<HeidiContextValue | null>(null)

/** Heidi's state lives here, above the pages, so the conversation survives navigation and collapse. */
export function HeidiProvider({ children, scope }: { children: ReactNode; scope: string }) {
  const { page, name } = pageOf(usePathname())
  const chat = useHeidiChat(page, scope)
  const [panel, setPanel] = useState(loadPanel)
  const [max, setMaxState] = useState(false)
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const returnFocus = useRef<HTMLElement | null>(null)
  const router = useRouter()
  const billing = useBilling().data
  // Heidi needs a plan with it: the panel stays shut and says which plan has it
  const lock = useMemo(() => featureLock(billing, 'heidi'), [billing])

  const persist = useCallback((next: PanelState) => {
    setPanel(next)
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next))
    } catch {}
  }, [])

  const setOpen = useCallback(
    (open: boolean) => {
      if (open && lock) {
        toastLocked(lock, () => router.push(PLANS_HREF))
        return
      }
      if (open && !panel.open && document.activeElement instanceof HTMLElement)
        returnFocus.current = document.activeElement
      if (!open) {
        setMaxState(false)
        // Focus goes back where it was before Heidi opened.
        requestAnimationFrame(() => returnFocus.current?.focus())
      }
      persist({ ...panel, open })
    },
    [panel, persist, lock, router],
  )

  const setMax = useCallback(
    (next: boolean) => {
      setMaxState(next)
      // Max mode on a page starts with a brief about it, ready to send.
      if (next && !draft.trim()) setDraft(translate('briefMeOn', { name: name }))
    },
    [draft, name],
  )

  const addFiles = useCallback((incoming: File[]) => {
    // Images and PDFs Heidi reads itself; anything an import reads (a ZIP, a spreadsheet) goes to one when sent.
    const accepted = incoming.filter((file) => chatReadable(file) || importable(file))
    if (accepted.length < incoming.length) toast.error(translate('heidiAcceptedImports'))
    setFiles((current) => {
      const { files: next, note } = addImportFiles(current, accepted)
      if (note) toast.error(note)
      return next
    })
  }, [])

  // Without AI on the installation there is no Heidi: every entry point reads a null context.
  const { available } = useAI('heidi')
  useShortcut('heidi', () => setOpen(!panel.open || Boolean(lock)), available)

  const value = useMemo<HeidiContextValue>(
    () => ({
      open: panel.open && !lock,
      max,
      width: panel.width,
      page,
      draft,
      files,
      chat,
      setOpen,
      setMax,
      setWidth: (width) => persist({ ...panel, width }),
      setDraft,
      addFiles,
      removeFile: (file) => setFiles((current) => current.filter((entry) => entry !== file)),
      clearFiles: () => setFiles([]),
      ask: (prompt) => {
        if (prompt) setDraft(prompt)
        if (!panel.open || lock) setOpen(true)
      },
    }),
    [panel, lock, max, page, draft, files, chat, setOpen, setMax, persist, addFiles],
  )

  return <HeidiContext.Provider value={available ? value : null}>{children}</HeidiContext.Provider>
}

/** Heidi's panel and conversation; null outside the signed-in area (and in isolated tests). */
export function useHeidi() {
  return useContext(HeidiContext)
}
