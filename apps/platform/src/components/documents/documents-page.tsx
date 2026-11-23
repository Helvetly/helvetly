'use client'
import {
  ActionMenuContent,
  type Action,
  type ActionMenuSpec,
} from '@helvetly/ui/components/action-menu'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { ContextMenuItem, ContextMenuSeparator } from '@helvetly/ui/components/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Loader } from '@helvetly/ui/components/loader'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Clock,
  HardDrive,
  Copy,
  Download,
  Loader2,
  Eye,
  FileSignature,
  Layers,
  LayoutTemplate,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  MousePointer2,
  List as ListIcon,
  Pencil,
  RotateCcw,
  Scissors,
  SearchX,
  Trash2,
  Upload as UploadIcon,
  X,
  Share2,
  Sparkles,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'

import { AIBudgetTip } from '@/components/ai/ai-budget'
import {
  lockedAction,
  PlanTag,
  toastLocked,
  useFeatureLock,
  type FeatureLock,
} from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { ListFilters, sinceOptions } from '@/components/data/list-filters'
import { ListSearch } from '@/components/data/list-toolbar'
import { LoadProblem } from '@/components/data/load-problem'
import { PageContextMenu } from '@/components/data/menus'
import { BulkBar, LoadingRows, State } from '@/components/data/table-page'
import { useImportAction, useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { useFileDrop } from '@/components/import/page-drop'
import { PageHeader } from '@/components/shell/page-header'
import { CreateSignatureDrawer } from '@/components/signatures/create-drawer'
import { RequestDrawer } from '@/components/signatures/request-drawer'
import { SignaturesView } from '@/components/signatures/signatures-view'
import { FillTemplateDrawer } from '@/components/templates/fill-drawer'
import { TemplateEditor } from '@/components/templates/template-editor'
import { TemplatesView } from '@/components/templates/templates-view'
import { useAI } from '@/lib/ai'
import { ApiError, errorMessage } from '@/lib/api'
import {
  ACCEPT,
  canDeleteForever,
  childrenOf,
  docKeys,
  docsApi,
  downloadUrl,
  KIND_LABELS,
  KINDS,
  DOC_TYPE_LABELS,
  DOC_TYPES,
  groupChange,
  groupLabel,
  groupsQuery,
  groupValue,
  listQuery,
  NO_CLIENT,
  openDim,
  storedGrouping,
  storeGrouping,
  useDocGroups,
  useZipExports,
  zipExportUrl,
  zipQuery,
  zipUrl,
  DEFAULT_VIEW,
  parseView,
  pathTo,
  refreshDocuments,
  SORT_FIELDS,
  useDocList,
  useStarFolder,
  useUsage,
  useFolders,
  useTrash,
  viewToQuery,
  type BulkResult,
  type DocFile,
  type DocType,
  type Folder,
  type GroupDim,
  type Kind,
  type Section,
  type SortField,
  type TrashItem,
  type ViewParams,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { among, oneValue, SINCE_PRESETS, type QueryField, type QueryOption } from '@/lib/list-query'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'
import { folderLabel, isSystemFolder, withoutEmptySystem } from '@/lib/system-folders'
import { useTemplates, type Template } from '@/lib/templates'
import { setUrlQuery } from '@/lib/url-query'

import { useAIFilingToast } from './ai-filing'
import { NewFolderDialog, FolderPickerDialog } from './dialogs'
import { DropProvider, useDropTarget, type DropActions } from './drop-target'
import { extractBlock } from './extract'
import { FolderMark } from './folder-art'
import { FolderTree } from './folder-tree'
import { GroupByMenu, GroupCrumbs, type ViewPreset } from './group-controls'
import { GroupView } from './group-view'
import { ItemsView } from './items-view'
import { KIND_STYLE, KindIcon } from './kind'
import { OrganizeDrawer } from './organize-drawer'
import { sameTab, tabOfView, usePinnedTabs, type PinnedTab } from './pinned-tabs'
import { Preview, type PreviewCommands } from './preview'
import { RecentStrip } from './recent-strip'
import { useCollapsed, type SectionId } from './section'
import {
  clickSelect,
  EMPTY_SELECTION,
  fileKey,
  folderKey,
  moveFocus,
  splitKeys,
  type DragPayload,
  type ItemKey,
  type Selection,
} from './selection'
import { ShareDrawer } from './share-drawer'
import { starAction } from './star'
import { StorageOverview } from './storage-overview'
import { TrashView } from './trash-view'
import { UploadTray, useUploads } from './upload-tray'

const SORT_LABELS: Record<SortField, string> = {
  name: translate('name'),
  created_at: translate('dateUploaded'),
  updated_at: translate('dateModified'),
  size: 'Size',
  kind: 'Kind',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Downloads one after another: browsers allow several when they follow a click. */
function downloadFiles(ids: string[]) {
  ids.forEach((id, i) =>
    setTimeout(() => {
      const link = document.createElement('a')
      link.href = downloadUrl(id)
      link.download = ''
      link.click()
    }, i * 400),
  )
}

type Picker = { mode: 'move' | 'copy'; files: string[]; folders: string[] }
type Clipboard = { mode: 'copy' | 'cut'; files: string[]; folders: string[] }
type Confirm = { kind: 'delete'; items: TrashItem[] } | { kind: 'empty' }

/** The refusal of a system folder in the user's language; any other error as the app shows it. */
function docError(error: unknown) {
  if (error instanceof ApiError && error.code === 'system_folder')
    toast.error(translate('systemFolderError'))
  else toastError(error)
}

/** The file manager: folder tree, breadcrumbs, grid or list, preview, uploads and the Trash. */
// The header tabs' icons, as the sidebar shows the same places.
const FolderTabIcon = ({ className }: { className?: string }) => (
  <FolderMark className={className} />
)
const KIND_TAB_ICONS = Object.fromEntries(
  KINDS.map((kind) => [
    kind,
    ({ className }: { className?: string }) => (
      <KindIcon kind={kind} className={cn('rounded-[4px] [&_svg]:size-3', className)} />
    ),
  ]),
)
const tabIcon = (tab: PinnedTab): ComponentType<{ className?: string }> =>
  tab.type === 'kind'
    ? (KIND_TAB_ICONS[tab.kind] ?? FolderTabIcon)
    : tab.type === 'recent'
      ? Clock
      : tab.type === 'signatures'
        ? FileSignature
        : tab.type === 'templates'
          ? LayoutTemplate
          : Trash2

const tabLabel = (tab: PinnedTab) =>
  tab.type === 'kind'
    ? `${KIND_LABELS[tab.kind]}s`
    : tab.type === 'recent'
      ? translate('recent')
      : tab.type === 'signatures'
        ? translate('signatures')
        : tab.type === 'templates'
          ? translate('templates')
          : translate('trash')
export function DocumentsPage() {
  const templateLock = useFeatureLock('document_templates')
  const signLock = useFeatureLock('simple_signatures')
  // Only to tell whether "Document from template…" has anything to offer.
  const templates = useTemplates(!templateLock)
  const aiLock = useFeatureLock('ai_import')
  const ai = useAI()
  const [organizing, setOrganizing] = useState(false)
  // Documents being read by "Extract with AI": the import drawer is open on them.
  const [extracting, setExtracting] = useState<string[] | null>(null)
  const pathname = usePathname()
  const query = useSearchParams()
  const view = parseView(query)
  const queryClient = useQueryClient()
  const pinned = usePinnedTabs()
  const session = useSession().data
  const canDelete = canDeleteForever(session?.role)
  const canWrite = useCan('write:documents')

  const folders = useFolders()
  const allFolders = folders.data ?? []
  const folderIds = new Set(allFolders.map((folder) => folder.id))
  // A folder that is gone (trashed elsewhere, a stale link) shows the top level instead.
  // Group by: virtual folders the API computes from what each file is (nothing moves); `dim` is the
  // level still to choose, null at the files of one group.
  const grouping = view.section === 'files' && view.group.length > 0
  const dim = grouping ? openDim(view) : null
  const current =
    !grouping && view.folder && (!folders.data || folderIds.has(view.folder)) ? view.folder : null
  const listing = view.section === 'files' || view.section === 'recent'
  const list = useDocList(
    listQuery({ ...view, folder: current }, session?.user.id),
    listing && !!session && dim === null,
  )
  const groupsLevel = useDocGroups(groupsQuery(view, session?.user.id), dim !== null && !!session)
  // The sidebar's Views and the client chip's names count over every file.
  const typeGroups = useDocGroups(
    groupsQuery({ ...DEFAULT_VIEW, group: ['type'] }, session?.user.id),
    listing && !!session,
  )
  const clientGroups = useDocGroups(
    groupsQuery({ ...DEFAULT_VIEW, group: ['client'] }, session?.user.id),
    listing && !!session,
  )
  const typeCount = (type: DocType) =>
    typeGroups.data?.groups.find((group) => group.key === type)?.count
  const presetCounts: Partial<Record<ViewPreset['id'], number>> = {
    invoices: typeCount('invoices'),
    quotes: typeCount('quotes'),
    receipts: typeCount('receipts'),
    clients: clientGroups.data?.groups.filter((group) => group.key !== NO_CLIENT).length,
  }
  const searchFields = queryFields(
    (clientGroups.data?.groups ?? []).map((group) => ({
      value: group.key,
      label: groupLabel('client', group),
    })),
  )
  const trash = useTrash()
  const sections = useCollapsed()
  const toggleStar = useStarFolder(docError)

  const [search, setSearch] = useState(view.search)
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  const [focused, setFocused] = useState<ItemKey | null>(null)
  const [renaming, setRenaming] = useState<ItemKey | null>(null)
  const [newFolderIn, setNewFolderIn] = useState<string | null | undefined>(undefined)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const [trashSelected, setTrashSelected] = useState<ReadonlySet<string>>(new Set())
  // The create drawer: undefined = closed, null = open without a PDF chosen yet.
  const [shareFrom, setShareFrom] = useState<DocFile | null>(null)
  const [signFrom, setSignFrom] = useState<DocFile | null | undefined>(undefined)
  // The template editor (a template to change, or a new one from an optional PDF) and filling one.
  const [editing, setEditing] = useState<
    { template: Template | null; document: DocFile | null } | undefined
  >(undefined)
  const [filling, setFilling] = useState<Template | null | undefined>(undefined)
  const uploads = useUploads()
  useAIFilingToast(uploads.uploads, uploads.clear)
  const importDrawer = useImportDrawer()
  const picker$ = useRef<HTMLInputElement>(null)
  const surface = useRef<HTMLDivElement>(null)

  const navigate = (change: Partial<ViewParams>, push = false) => {
    setUrlQuery(pathname, viewToQuery({ ...view, ...change }), push)
  }
  const clearSelection = () => {
    setSelection(EMPTY_SELECTION)
    setFocused(null)
  }
  const openFolder = (id: string | null) => {
    clearSelection()
    setSearch('')
    navigate({ section: 'files', folder: id, search: '', file: null, group: [], ...NO_GROUP }, true)
  }
  const setGrouping = (group: GroupDim[], change: Partial<ViewParams> = {}) => {
    storeGrouping(group)
    clearSelection()
    navigate({ section: 'files', folder: null, file: null, group, ...NO_GROUP, ...change }, true)
  }
  // The builder's levels: the groups chosen so far stay as filters (the search's chips).
  const changeLevels = (group: GroupDim[]) => {
    storeGrouping(group)
    clearSelection()
    navigate({ section: 'files', folder: null, file: null, group }, true)
  }
  const openGroup = (by: GroupDim, key: string) => {
    clearSelection()
    navigate({ ...groupChange(by, key), file: null }, true)
  }
  // Back to a level of the breadcrumb: the groups chosen before it stay.
  const openLevel = (index: number) => {
    clearSelection()
    const chosen = view.group.filter((by) => groupValue(view, by) !== null)
    const change: Partial<ViewParams> = { file: null }
    for (const by of chosen.slice(index)) Object.assign(change, groupChange(by, null))
    navigate(change, true)
  }
  const groupName = (by: GroupDim, key: string) =>
    by === 'client' && !clientGroups.data
      ? translate('client')
      : groupLabel(by, {
          key,
          label: clientGroups.data?.groups.find((group) => group.key === key)?.label ?? '',
        })
  // The ZIP of what the view (or one of its groups) shows: asked first, so one too big says so instead of a
  // broken download; one too big to stream is prepared in the background and announced in the bell.
  const zipExports = useZipExports(view.section === 'files' && !!session)
  const zipPending = zipExports.data?.some((zip) => zip.status === 'pending') ?? false
  const downloadZip = (change: Partial<ViewParams> = {}) => {
    const target = { ...view, folder: current, ...change }
    const zip = zipQuery(target, session?.user.id)
    docsApi
      .checkZip(zip)
      .then(async (check) => {
        if (!check?.data.async) {
          saveFile(zipUrl(target, session?.user.id))
          toast.success(translate('zipStarted'))
          return
        }
        await docsApi.queueZip(zip)
        void queryClient.invalidateQueries({ queryKey: docKeys.zipExports })
        toast.success(translate('zipQueued'))
      })
      .catch(docError)
  }
  // The bell's "Your ZIP is ready" opens Documents with ?zip=<id>: the download starts, or it says it is gone.
  const zipLink = query.get('zip')
  const openZipLink = useEffectEvent((id: string) => {
    docsApi.zipExports().then(({ data }) => {
      const zip = data.find((entry) => entry.id === id)
      if (zip?.status === 'ready') saveFile(zipExportUrl(id))
      else toast.error(translate('zipGone'))
      navigate({})
    }, docError)
  })
  useEffect(() => {
    if (zipLink) openZipLink(zipLink)
  }, [zipLink])
  // The last Group by choice comes back when Documents opens plainly (nothing chosen in the link).
  const restoreGrouping = useEffectEvent(() => {
    if (query.toString() !== '') return
    const stored = storedGrouping()
    if (stored.length > 0) navigate({ group: stored })
  })
  useEffect(() => restoreGrouping(), [])
  const openSection = (section: Section) => {
    clearSelection()
    setTrashSelected(new Set())
    setSearch('')
    navigate(
      {
        section,
        search: '',
        file: null,
        ...(section !== 'files' && { folder: null, group: [], ...NO_GROUP }),
      },
      true,
    )
  }

  // Search waits for a pause in typing, then goes to the URL (and so to the server).
  useEffect(() => {
    if (search === view.search) return
    const timer = setTimeout(() => navigate({ search }), 250)
    return () => clearTimeout(timer)
  })

  const folderName = (id: string | null) =>
    id
      ? folderLabel(
          allFolders.find((folder) => folder.id === id) ?? { name: translate('theFolder') },
        )
      : translate('allDocuments')

  // ---- what is on screen ----
  const byGroup = view.type !== null || view.year !== null || view.client !== null
  const filtered = view.kinds.length > 0 || view.mine || view.date !== null || byGroup || grouping
  const searching = view.search.trim().length > 0
  const visibleFolders: Folder[] =
    view.section !== 'files' || filtered
      ? []
      : searching
        ? allFolders.filter((folder) =>
            folderLabel(folder).toLowerCase().includes(view.search.trim().toLowerCase()),
          )
        : (childrenOf(
            withoutEmptySystem(allFolders, new Set(pathTo(allFolders, current).map((f) => f.id))),
          ).get(current ?? '') ?? [])
  if (view.sort === 'name' && view.desc) visibleFolders.reverse()
  // At a level of groups there are no files on screen (the list keeps its last page as a placeholder).
  const files = dim === null ? (list.data?.data ?? []) : []
  // The top level of "All documents", unfiltered: the storage overview and Recent show there.
  const home = view.section === 'files' && current === null && !searching && !filtered
  const usage = useUsage(home)
  const recentQuery = listQuery({ ...DEFAULT_VIEW, section: 'recent' }, session?.user.id)
  recentQuery.set('page_size', '8')
  const recent = useDocList(recentQuery, home && !!session)
  const recentFiles = home ? (recent.data?.data ?? []) : []
  // Folded grid sections are out of reach of the keyboard and ⌘A.
  const hidden = (id: SectionId) => view.layout === 'grid' && sections.collapsed.has(id)
  const order: ItemKey[] = [
    ...(hidden('folders') ? [] : visibleFolders.map((folder) => folderKey(folder.id))),
    ...(hidden('files') ? [] : files.map((file) => fileKey(file.id))),
  ]
  const selectedKeys = new Set([...selection.keys].filter((key) => order.includes(key)))
  const selectedSplit = splitKeys(selectedKeys)
  // System folders cannot be renamed, moved or trashed; their files can.
  const managed = new Set(allFolders.filter(isSystemFolder).map((folder) => folder.id))
  const hasManaged = (split: { folders: string[] }) => split.folders.some((id) => managed.has(id))
  // Why "Extract with AI" cannot read these items (the plan's reason first), or null when it can.
  const extractReason = (split: { files: string[]; folders: string[] }) =>
    aiLock?.hint ??
    (ai.usedUp ? translate('aiBudgetUsedUp') : null) ??
    extractBlock(
      [...files, ...recentFiles].filter((file) => split.files.includes(file.id)),
      split.folders.length,
    )

  // ---- commands ----
  const reportBulk = (result: BulkResult, verb: string, retry?: (ids: string[]) => void) => {
    const done = result.updated > 0 ? `${plural(result.updated, 'item')} ${verb}.` : ''
    if (result.skipped.length === 0) {
      toast.success(done)
      return
    }
    const reasons = [...new Set(result.skipped.map((skip) => skip.reason))].join(' ')
    const nameClash = result.skipped.some((skip) => skip.reason.includes('already here'))
    toast(`${done} ${plural(result.skipped.length, 'item')} skipped: ${reasons}`.trim(), {
      action:
        retry && nameClash
          ? {
              label: translate('keepBoth'),
              onClick: () => retry(result.skipped.map((skip) => skip.id)),
            }
          : undefined,
    })
  }

  const runBulk = async (body: Parameters<typeof docsApi.bulk>[0]) => {
    const { data } = await docsApi.bulk(body)
    refreshDocuments(queryClient)
    return data
  }

  const move = (payload: { files: string[]; folders: string[] }, target: string | null) =>
    runBulk({
      action: 'move',
      document_ids: payload.files,
      folder_ids: payload.folders,
      folder_id: target,
    }).then((result) => {
      reportBulk(
        result,
        translate('movedTo', { value1: folderName(target) }),
        (ids) =>
          void runBulk({
            action: 'move',
            document_ids: payload.files.filter((id) => ids.includes(id)),
            folder_ids: payload.folders.filter((id) => ids.includes(id)),
            folder_id: target,
            on_conflict: 'keep_both',
          }).then(
            (again) => reportBulk(again, translate('movedTo', { value1: folderName(target) })),
            docError,
          ),
      )
      clearSelection()
    }, docError)

  const trashItems = (payload: { files: string[]; folders: string[] }) =>
    runBulk({ action: 'trash', document_ids: payload.files, folder_ids: payload.folders }).then(
      (result) => {
        clearSelection()
        if (result.skipped.length) reportBulk(result, translate('movedToTheTrash3'))
        else
          toast.success(translate('movedToTheTrash2', { value1: plural(result.updated, 'item') }), {
            action: {
              label: translate('undo'),
              onClick: () =>
                void runBulk({
                  action: 'restore',
                  document_ids: payload.files,
                  folder_ids: payload.folders,
                }),
            },
          })
        if (view.file && payload.files.includes(view.file)) navigate({ file: null })
      },
      docError,
    )

  const copyFiles = async (ids: string[], target: string | null) => {
    try {
      await Promise.all(ids.map((id) => docsApi.copy(id, target)))
      toast.success(
        translate('madeIn', {
          value1: plural(ids.length, 'copy', 'copies'),
          value2: folderName(target),
        }),
      )
    } catch (error) {
      docError(error)
    } finally {
      refreshDocuments(queryClient)
    }
  }

  const upload = (picked: File[], target: string | null) => {
    if (!canWrite || picked.length === 0) return
    uploads.add(picked, target, folderName(target))
  }

  const rename = async (key: ItemKey, name: string) => {
    const {
      folders: [folderId],
      files: [fileId],
    } = splitKeys([key])
    try {
      if (folderId) await docsApi.updateFolder(folderId, { name })
      else if (fileId) await docsApi.update(fileId, { name })
      refreshDocuments(queryClient)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'name_taken' && fileId) {
        const suggestion = error.details.suggestion
        toast.error(error.message, {
          action:
            typeof suggestion === 'string'
              ? {
                  label: translate('use', { suggestion: suggestion }),
                  onClick: () =>
                    void docsApi
                      .update(fileId, { name: suggestion })
                      .then(() => refreshDocuments(queryClient), docError),
                }
              : undefined,
        })
      } else docError(error)
    }
  }

  const createFolder = async (name: string) => {
    try {
      const { data } = await docsApi.createFolder(name, newFolderIn ?? null)
      refreshDocuments(queryClient)
      toast.success(translate('created2', { name: data.name }))
      return null
    } catch (error) {
      if (error instanceof ApiError && error.code === 'validation_failed') {
        const fields = error.details.fields
        if (
          typeof fields === 'object' &&
          fields !== null &&
          'name' in fields &&
          typeof fields.name === 'string'
        )
          return fields.name
      }
      return errorMessage(error)
    }
  }

  const paste = () => {
    if (!clipboard || view.section !== 'files') return
    if (clipboard.mode === 'copy') void copyFiles(clipboard.files, current)
    else {
      void move(clipboard, current)
      setClipboard(null)
    }
  }

  const openItem = (key: ItemKey) => {
    const {
      folders: [folderId],
      files: [fileId],
    } = splitKeys([key])
    if (folderId) openFolder(folderId)
    else if (fileId) navigate({ file: fileId })
  }

  const dropActions: DropActions = {
    folders: allFolders,
    move: (payload: DragPayload, target) => void move(payload, target),
    upload,
    trash: (payload) => void trashItems(payload),
  }

  // Files dragged in from the desktop light up the whole page; a drop outside a folder goes to the current one.
  const desktopDrag = useFileDrop(canWrite && view.section !== 'trash', (dropped) =>
    upload(dropped, current),
  )

  // ---- selection and keyboard ----
  // A plain click opens the item (a file's preview, a folder); ⌘/Ctrl and Shift select, as does its checkbox.
  const onItemClick = (key: ItemKey, event: MouseEvent) => {
    setFocused(key)
    // The second click of a double-click would land on whatever the opened folder shows there.
    if (event.detail > 1) return
    const shift = event.shiftKey
    const toggle = event.metaKey || event.ctrlKey
    if (!shift && !toggle) return openItem(key)
    setSelection(
      clickSelect(selection, key, order, {
        shift,
        toggle,
      }),
    )
  }

  const focusNext = (key: string, extend: boolean) => {
    const index = focused ? order.indexOf(focused) : -1
    let next = -1
    if (view.layout === 'grid' && (key === 'ArrowUp' || key === 'ArrowDown') && index >= 0) {
      next = verticalNeighbour(surface.current, order, index, key === 'ArrowDown')
    } else if (
      key === 'ArrowUp' ||
      key === 'ArrowDown' ||
      key === 'ArrowLeft' ||
      key === 'ArrowRight' ||
      key === 'Home' ||
      key === 'End'
    ) {
      next = moveFocus(index, order.length, key, 1)
    }
    const target = order[next]
    if (!target) return
    setFocused(target)
    setSelection(clickSelect(selection, target, order, { shift: extend, toggle: false }))
    surface.current?.querySelector(`[data-key="${target}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  // Shortcuts work anywhere on the page, except while typing or in a dialog or menu.
  const onKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    const target = event.target
    const busy =
      renaming ||
      view.file ||
      view.request ||
      signFrom !== undefined ||
      picker ||
      confirm ||
      newFolderIn !== undefined
    if (event.defaultPrevented || busy || view.section === 'trash' || order.length === 0) return
    if (
      target instanceof Element &&
      target.closest('input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]')
    )
      return
    const mod = event.metaKey || event.ctrlKey
    const key = event.key
    if (mod && key.toLowerCase() === 'a') {
      event.preventDefault()
      setSelection({ keys: new Set(order), anchor: order[0] ?? null })
    } else if (key === 'Escape') clearSelection()
    else if (
      canWrite &&
      (key === 'Delete' || key === 'Backspace') &&
      selectedKeys.size > 0 &&
      !hasManaged(selectedSplit)
    ) {
      event.preventDefault()
      void trashItems(selectedSplit)
    } else if (canWrite && key === 'F2' && selectedKeys.size === 1 && !hasManaged(selectedSplit)) {
      event.preventDefault()
      setRenaming([...selectedKeys][0] ?? null)
    } else if (key === 'Enter' && focused) openItem(focused)
    else if (mod && key.toLowerCase() === 'c' && selectedSplit.files.length > 0) {
      setClipboard({ mode: 'copy', files: selectedSplit.files, folders: [] })
      toast(
        translate('copiedPasteWithVInAnyFolder', {
          value1: plural(selectedSplit.files.length, 'file'),
        }),
      )
    } else if (
      canWrite &&
      mod &&
      key.toLowerCase() === 'x' &&
      selectedKeys.size > 0 &&
      !hasManaged(selectedSplit)
    ) {
      setClipboard({ mode: 'cut', ...selectedSplit })
      toast(
        translate('cutPasteWithVInAnotherFolder', { value1: plural(selectedKeys.size, 'item') }),
      )
    } else if (canWrite && mod && key.toLowerCase() === 'v') paste()
    else if (key.startsWith('Arrow') || key === 'Home' || key === 'End') {
      event.preventDefault()
      focusNext(key, event.shiftKey)
    }
  })
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => onKeyDown(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // ---- the context menu of an item (acts on the whole selection when the item is in it) ----
  const menu = (key: ItemKey) => {
    const keys = selectedKeys.has(key) ? [...selectedKeys] : [key]
    const split = splitKeys(keys)
    const single = keys.length === 1
    const file = [...files, ...recentFiles].find((entry) => fileKey(entry.id) === key)
    const folder = file ? undefined : allFolders.find((entry) => folderKey(entry.id) === key)
    const name = file ? file.name : folder && folderLabel(folder)
    const locked = hasManaged(split)
    const pdf = canWrite && single && file?.kind === 'pdf' && !file.deleted_at
    const extract = extractReason(split)
    return (
      <ActionMenuContent
        kind="context"
        menu={{
          header: single ? name : translate('dynamicSelected2', { length: keys.length }),
          actions: [
            single && {
              id: 'open',
              group: 'view',
              icon: file ? <Eye /> : <FolderOpen />,
              label: file ? translate('preview') : translate('openAction'),
              shortcut: '↵',
              onSelect: () => openItem(key),
            },
            split.files.length > 0 && {
              id: 'download',
              group: 'view',
              icon: <Download />,
              label: `${translate('download3')}${
                split.files.length > 1
                  ? translate('dynamicFiles2', { length: split.files.length })
                  : ''
              }`,
              onSelect: () => downloadFiles(split.files),
            },
            canWrite &&
              single &&
              file &&
              !file.deleted_at && {
                id: 'share',
                group: 'send',
                icon: <Share2 />,
                label: translate('shareWithClient'),
                onSelect: () => setShareFrom(file),
              },
            pdf && {
              id: 'sign',
              group: 'send',
              icon: <FileSignature />,
              label: translate('sendForSignature'),
              ...lockedAction(signLock),
              onSelect: () => setSignFrom(file),
            },
            single && folder && starAction(folder, toggleStar),
            canWrite &&
              single &&
              !locked && {
                id: 'rename',
                group: 'edit',
                icon: <Pencil />,
                label: translate('rename'),
                shortcut: translate('f2'),
                onSelect: () => setRenaming(key),
              },
            canWrite &&
              !locked && {
                id: 'move',
                group: 'edit',
                icon: <FolderInput />,
                label: translate('moveTo2'),
                onSelect: () => setPicker({ mode: 'move', ...split }),
              },
            canWrite &&
              !locked &&
              split.files.length > 0 &&
              split.folders.length === 0 && {
                id: 'copy',
                group: 'edit',
                icon: <Copy />,
                label: translate('copyTo2'),
                onSelect: () => setPicker({ mode: 'copy', ...split }),
              },
            canWrite &&
              !locked && {
                id: 'cut',
                group: 'edit',
                icon: <Scissors />,
                label: translate('cut'),
                shortcut: translate('x'),
                onSelect: () => setClipboard({ mode: 'cut', ...split }),
              },
            pdf && {
              id: 'template',
              group: 'create',
              icon: <LayoutTemplate />,
              label: translate('makeATemplate'),
              ...lockedAction(templateLock),
              onSelect: () => setEditing({ template: null, document: file }),
            },
            canWrite &&
              ai.available && {
                id: 'extract',
                group: 'create',
                tone: 'ai',
                icon: <HeidiSparkle />,
                label: translate('extractWithAI'),
                ...lockedAction(aiLock),
                disabledReason: aiLock?.hint ?? extract ?? undefined,
                onSelect: () => setExtracting(split.files),
              },
            canWrite &&
              !locked && {
                id: 'trash',
                group: 'danger',
                icon: <Trash2 />,
                label: translate('moveToTrash2'),
                shortcut: '⌫',
                onSelect: () => void trashItems(split),
              },
          ],
        }}
      />
    )
  }

  const previewCommands: PreviewCommands = {
    rename: (file) => {
      navigate({ file: null })
      setSelection({ keys: new Set([fileKey(file.id)]), anchor: fileKey(file.id) })
      setRenaming(fileKey(file.id))
    },
    move: (file) => setPicker({ mode: 'move', files: [file.id], folders: [] }),
    copy: (file) => void copyFiles([file.id], file.folder_id),
    trash: (file) => void trashItems({ files: [file.id], folders: [] }),
    restore: (file) =>
      void runBulk({ action: 'restore', document_ids: [file.id] }).then(
        (result) => reportBulk(result, 'restored'),
        docError,
      ),
    link: (file, clientId) =>
      void docsApi.link(file.id, 'client', clientId).then(() => {
        refreshDocuments(queryClient)
        toast.success(translate('linkedToTheClient'))
      }, docError),
    unlink: (file, link) =>
      void docsApi
        .unlink(file.id, link.type, link.id)
        .then(() => refreshDocuments(queryClient), docError),
    openFolder: (folder) => openFolder(folder),
    sign: (file) => {
      navigate({ file: null })
      setSignFrom(file)
    },
    extract: (file) => {
      navigate({ file: null })
      setExtracting([file.id])
    },
  }

  // ---- Trash ----
  const trashItemsList = trash.data ?? []
  const restoreFromTrash = (items: TrashItem[]) =>
    void runBulk({
      action: 'restore',
      document_ids: items.filter((item) => item.type === 'file').map((item) => item.id),
      folder_ids: items.filter((item) => item.type === 'folder').map((item) => item.id),
    }).then((result) => {
      setTrashSelected(new Set())
      reportBulk(result, 'restored')
    }, docError)
  const deleteForever = (items: TrashItem[]) =>
    void runBulk({
      action: 'delete',
      document_ids: items.filter((item) => item.type === 'file').map((item) => item.id),
      folder_ids: items.filter((item) => item.type === 'folder').map((item) => item.id),
    }).then((result) => {
      setTrashSelected(new Set())
      reportBulk(result, translate('deletedForever2'))
    }, docError)

  // The page's own actions: the header's "…" menu and a right-click on the empty surface.
  // The header's "…" leaves New folder to the Create menu beside it.
  // The header has its own Upload and "New" buttons, so its "…" menu keeps Import and Paste.
  const importAction = useImportAction(translate('importInvoicesContracts'), importDrawer.open)
  const pageItems = (inHeader = false): ActionMenuSpec['actions'] => [
    canWrite &&
      !inHeader && {
        id: 'new-folder',
        group: 'create',
        icon: <FolderPlus />,
        label: translate('newFolder2'),
        onSelect: () => setNewFolderIn(current),
      },
    canWrite &&
      !inHeader && {
        id: 'upload',
        group: 'create',
        icon: <UploadIcon />,
        label: translate('uploadFiles2'),
        onSelect: () => picker$.current?.click(),
      },
    canWrite && importAction,
    canWrite &&
      clipboard &&
      view.section === 'files' && {
        id: 'paste',
        group: 'edit',
        icon: <ClipboardPaste />,
        label: `${translate('paste')} ${plural(clipboard.files.length + clipboard.folders.length, 'item')}`,
        shortcut: translate('v'),
        onSelect: paste,
      },
    view.section === 'files' && zipAction(),
  ]
  // Download as ZIP: what the view shows; off while there is nothing, or while a ZIP is being prepared.
  const zipEmpty =
    dim === null ? list.data?.data.length === 0 : groupsLevel.data?.groups.length === 0
  const zipAction = (): Action => ({
    id: 'zip',
    group: 'view',
    icon: zipPending ? <Loader2 className="animate-spin" /> : <Download />,
    label: zipPending ? translate('zipPreparing') : translate('downloadAsZip'),
    disabledReason: zipPending
      ? translate('zipPreparingHint')
      : zipEmpty
        ? translate('zipNothingHere')
        : undefined,
    onSelect: () => downloadZip(),
  })

  const crumbs = pathTo(allFolders, current)
  // ---- header tabs: the fixed "All files" and the views the person pinned. Browsing never opens a
  // tab: anything not pinned (a folder, a section from the sidebar) shows under "All files".
  const headerTabs = pinned.tabs
  const here = tabOfView(view)
  const activeTab = here ? headerTabs.findIndex((tab) => sameTab(tab, here)) + 1 : 0
  const openTab = (index: number) => {
    const tab = headerTabs[index - 1]
    if (!tab || tab.type === 'kind') {
      clearSelection()
      setSearch('')
      navigate(
        { section: 'files', folder: null, kinds: tab ? [tab.kind] : [], search: '', file: null },
        true,
      )
    } else openSection(tab.type)
  }
  const tabMenu = (index: number) => {
    const tab = headerTabs[index - 1]
    if (!tab) return null
    const at = pinned.tabs.findIndex((entry) => sameTab(entry, tab))
    return (
      <>
        <ContextMenuItem disabled={at === 0} onSelect={() => pinned.move(at, at - 1)}>
          <ArrowLeft />
          {translate('moveLeft')}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={at === pinned.tabs.length - 1}
          onSelect={() => pinned.move(at, at + 1)}
        >
          <ArrowRight />
          {translate('moveRight')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => pinned.toggle(tab)}>
          <X />
          {translate('closeTab')}
        </ContextMenuItem>
      </>
    )
  }
  const showLocation = searching || view.section === 'recent' || grouping || byGroup
  const dropHere = view.section === 'trash' ? null : current
  const surfaceDrop = useDropTarget(dropHere)
  const loading = listing && dim === null && !list.data && !list.error

  // The header's solid button: Upload for files, "New" in Templates and Signatures (locked: says why).
  const sectionLock =
    view.section === 'templates' ? templateLock : view.section === 'signatures' ? signLock : null
  const primaryLabel = listing
    ? translate('upload2')
    : view.section === 'templates'
      ? translate('newTemplate')
      : view.section === 'signatures' && canWrite
        ? translate('pdfForSignature3')
        : undefined

  return (
    <DropProvider value={canWrite ? dropActions : null}>
      <input
        ref={picker$}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          upload([...(event.target.files ?? [])], view.section === 'files' ? current : null)
          event.target.value = ''
        }}
      />
      <PageHeader
        tabs={[translate('allFiles'), ...headerTabs.map(tabLabel)]}
        tabIcons={[HardDrive, ...headerTabs.map(tabIcon)]}
        active={activeTab}
        onSelect={openTab}
        tabMenu={tabMenu}
        onCloseTab={(index) => {
          const tab = headerTabs[index - 1]
          if (!tab) return undefined
          return () => {
            // Closing the tab you are on goes back to All files, like a browser.
            if (index === activeTab) openTab(0)
            pinned.toggle(tab)
          }
        }}
        savedViews={false}
        keepTab
        // Upload, Create, Organize and "…" act on files; Templates and Signatures put their own
        // "New" here instead, and Trash has its controls under the tabs.
        actions={
          (sectionLock && <PlanTag lock={sectionLock} className="self-center" />) ||
          (canWrite && listing && (
            <>
              {ai.available && (
                <AIBudgetTip usedUp={ai.usedUp}>
                  <Button
                    variant="ai"
                    disabled={ai.usedUp}
                    onClick={() => (aiLock ? toastLocked(aiLock) : setOrganizing(true))}
                  >
                    <HeidiSparkle />
                    {translate('organizeButton')}
                    {aiLock && <PlanTag lock={aiLock} />}
                  </Button>
                </AIBudgetTip>
              )}
              <CreateMenu
                templateLock={templateLock}
                signLock={signLock}
                noTemplates={templates.data?.length === 0}
                onFromTemplate={() => setFilling(null)}
                onSign={() => setSignFrom(null)}
                onFolder={() => setNewFolderIn(current)}
              />
            </>
          ))
        }
        primary={primaryLabel}
        onPrimary={() => {
          if (listing) picker$.current?.click()
          else if (sectionLock) toastLocked(sectionLock)
          else if (view.section === 'templates') setEditing({ template: null, document: null })
          else setSignFrom(null)
        }}
        menu={listing ? pageItems(true) : undefined}
      />
      {organizing && (
        <OrganizeDrawer
          folderId={view.section === 'files' ? current : null}
          onClose={() => setOrganizing(false)}
        />
      )}
      <div className="relative flex flex-1">
        <aside className="hidden w-[248px] shrink-0 border-r md:block">
          <div className="sticky top-[52px] h-[calc(100svh-68px)] overflow-y-auto">
            {folders.data ? (
              <FolderTree
                folders={allFolders}
                current={current}
                section={view.section}
                trashCount={trashItemsList.length}
                kinds={view.kinds}
                pinned={pinned}
                actions={{
                  create: (name) =>
                    void docsApi.createFolder(name, null).then(({ data }) => {
                      refreshDocuments(queryClient)
                      openFolder(data.id)
                    }, docError),
                  kinds: (kinds) => navigate({ section: 'files', kinds }),
                  open: openFolder,
                  section: openSection,
                  newFolder: (parent) => setNewFolderIn(parent),
                  rename: (folder, name) => void rename(folderKey(folder.id), name),
                  trash: (folder) => void trashItems({ files: [], folders: [folder.id] }),
                  star: toggleStar,
                }}
              />
            ) : (
              <LoadingTree />
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-[52px] z-10 flex h-12 shrink-0 items-center gap-1 border-b bg-card px-2 md:px-3">
            {grouping ? (
              <GroupCrumbs
                view={view}
                label={groupName}
                onFolders={() => openFolder(null)}
                onLevel={openLevel}
              />
            ) : view.section === 'files' ? (
              <Breadcrumbs
                crumbs={crumbs}
                searching={searching}
                term={view.search}
                onOpen={openFolder}
              />
            ) : (
              <p className="flex min-w-0 flex-1 items-center gap-2 px-2 text-[15px] font-medium">
                {view.section === 'recent' ? (
                  <Clock className="size-4 stroke-[1.5] text-muted-foreground" />
                ) : view.section === 'signatures' ? (
                  <FileSignature className="size-4 stroke-[1.5] text-muted-foreground" />
                ) : view.section === 'templates' ? (
                  <LayoutTemplate className="size-4 stroke-[1.5] text-muted-foreground" />
                ) : (
                  <Trash2 className="size-4 stroke-[1.5] text-muted-foreground" />
                )}
                {view.section === 'recent'
                  ? translate('recentlyUploaded')
                  : view.section === 'signatures'
                    ? translate('outForSignature')
                    : view.section === 'templates'
                      ? translate('templates')
                      : translate('trash')}
              </p>
            )}
            {listing && (
              <>
                <ListSearch
                  collapsible
                  className="mr-1 flex-none"
                  label={translate('searchFiles')}
                  placeholder={translate('searchAllFiles')}
                  value={search}
                  onChange={setSearch}
                  query={{
                    fields: searchFields,
                    params: view,
                    onChange: (change) => navigate(change),
                  }}
                />
                <Filters
                  view={view}
                  fields={searchFields}
                  onChange={(change) => navigate(change)}
                />
                {view.section === 'files' && (
                  <GroupByMenu
                    view={view}
                    counts={presetCounts}
                    onPreset={(preset) => setGrouping(preset.group, { type: preset.type })}
                    onChange={changeLevels}
                  />
                )}
                {view.section === 'files' && dim === null && (
                  <SortMenu view={view} onChange={(change) => navigate(change)} />
                )}
                <ViewToggle layout={view.layout} onChange={(layout) => navigate({ layout })} />
              </>
            )}
          </div>

          {view.section === 'templates' ? (
            <TemplatesView
              onEdit={(template) => setEditing({ template, document: null })}
              onFill={(template) => setFilling(template)}
            />
          ) : view.section === 'signatures' ? (
            <SignaturesView
              onOpen={(id) => navigate({ request: id })}
              onShowDocument={(request, file) =>
                navigate(
                  { section: 'files', folder: request.folder_id, file, request: null, ...NO_GROUP },
                  true,
                )
              }
            />
          ) : view.section === 'trash' ? (
            <TrashView
              items={trash.data}
              error={trash.error}
              onRetry={() => void trash.refetch()}
              selected={trashSelected}
              onToggle={(item) => {
                const next = new Set(trashSelected)
                if (!next.delete(item.id)) next.add(item.id)
                setTrashSelected(next)
              }}
              onToggleAll={(all) =>
                setTrashSelected(new Set(all ? trashItemsList.map((item) => item.id) : []))
              }
              onOpen={(item) => {
                if (item.type === 'file') navigate({ file: item.id })
              }}
              onRestore={restoreFromTrash}
              onDelete={(items) => setConfirm({ kind: 'delete', items })}
              onEmpty={() => setConfirm({ kind: 'empty' })}
              canDelete={canDelete}
            />
          ) : (
            <PageContextMenu
              title={view.section === 'files' ? folderName(current) : translate('recentlyUploaded')}
              actions={pageItems()}
              views={{
                tabs: [translate('allFiles'), ...headerTabs.map(tabLabel)],
                active: activeTab,
                onSelect: openTab,
              }}
              selectAll={
                order.length > 0 && selectedKeys.size < order.length
                  ? {
                      onSelect: () =>
                        setSelection({ keys: new Set(order), anchor: order[0] ?? null }),
                      keys: '⌘A',
                    }
                  : undefined
              }
              onRefresh={() => refreshDocuments(queryClient)}
            >
              <div
                ref={surface}
                className={cn(
                  'relative flex flex-1 flex-col outline-none',
                  surfaceDrop.over && 'bg-primary/[0.025]',
                )}
                {...surfaceDrop.props}
              >
                {home && usage.data && usage.data.files > 0 && (
                  <StorageOverview usage={usage.data} onTrash={() => openSection('trash')} />
                )}
                {dim !== null ? (
                  groupsLevel.error ? (
                    <LoadProblem
                      error={groupsLevel.error}
                      what={translate('theFiles')}
                      onRetry={() => void groupsLevel.refetch()}
                    />
                  ) : groupsLevel.data?.by !== dim ? (
                    <LoadingRows />
                  ) : groupsLevel.data.groups.length === 0 ? (
                    <State
                      icon={<Layers />}
                      title={translate('groupEmpty')}
                      text={translate('groupEmptyText')}
                      action={
                        <Button
                          variant="outline"
                          size="sm"
                          className="cursor-pointer"
                          onClick={() => setGrouping([])}
                        >
                          {translate('groupingFolders')}
                        </Button>
                      }
                    />
                  ) : (
                    <GroupView
                      dim={dim}
                      groups={groupsLevel.data.groups}
                      layout={view.layout}
                      onOpen={(group) => openGroup(dim, group.key)}
                      onDownload={(group) => downloadZip(groupChange(dim, group.key))}
                    />
                  )
                ) : list.error ? (
                  <LoadProblem
                    error={list.error}
                    what={translate('theFiles')}
                    onRetry={() => void list.refetch()}
                  />
                ) : loading ? (
                  <LoadingRows />
                ) : visibleFolders.length + files.length === 0 ? (
                  <Empty
                    view={view}
                    folderName={folderName(current)}
                    onUpload={() => picker$.current?.click()}
                    onNewFolder={() => setNewFolderIn(current)}
                    onClear={() => {
                      setSearch('')
                      navigate({ search: '', kinds: [], mine: false, date: null, ...NO_GROUP })
                    }}
                  />
                ) : (
                  <div
                    className={cn(
                      'flex-1 transition-opacity duration-150',
                      list.isPlaceholderData && 'opacity-60',
                    )}
                  >
                    <ItemsView
                      layout={view.layout}
                      folders={visibleFolders}
                      files={files}
                      selected={selectedKeys}
                      focused={focused}
                      renaming={renaming}
                      showLocation={showLocation}
                      from={showLocation ? '*' : current}
                      sort={view.sort}
                      desc={view.desc}
                      onSort={(field, desc) => navigate({ sort: field, desc })}
                      onClick={onItemClick}
                      onToggle={(key, modifiers) => {
                        setFocused(key)
                        setSelection(clickSelect(selection, key, order, modifiers))
                      }}
                      onToggleAll={(all) =>
                        setSelection({ keys: new Set(all ? order : []), anchor: order[0] ?? null })
                      }
                      onRenameDone={(key, name) => {
                        setRenaming(null)
                        surface.current?.focus()
                        if (name) void rename(key, name)
                      }}
                      onContext={(key) => {
                        if (!selectedKeys.has(key))
                          setSelection({ keys: new Set([key]), anchor: key })
                      }}
                      menu={menu}
                      onBand={(keys, additive) =>
                        setSelection({
                          keys: new Set(additive ? [...selection.keys, ...keys] : keys),
                          anchor: keys[0] ?? null,
                        })
                      }
                      onBackground={clearSelection}
                      collapsed={sections.collapsed}
                      onToggleSection={sections.toggle}
                      recent={
                        recentFiles.length > 0 ? (
                          <RecentStrip
                            files={recentFiles}
                            menu={menu}
                            onOpen={(file) => navigate({ file: file.id })}
                          />
                        ) : undefined
                      }
                    />
                    {list.data && list.data.meta.total > files.length && (
                      <p className="px-5 pb-6 text-center text-[13px] text-muted-foreground">
                        {translate('showingTheFirst')}
                        {files.length}
                        {translate('of5')}
                        {list.data.meta.total}
                        {translate('filesSearchOrFilterToFindTheRest')}
                      </p>
                    )}
                  </div>
                )}

                {selectedKeys.size > 0 && (
                  <BulkBar
                    count={selectedKeys.size}
                    onClear={clearSelection}
                    actions={[
                      ...(selectedSplit.files.length > 0
                        ? [
                            {
                              label: translate('download'),
                              icon: <Download />,
                              onClick: () => downloadFiles(selectedSplit.files),
                            },
                          ]
                        : []),
                      {
                        label: translate('moveTo'),
                        icon: <FolderInput />,
                        onClick: () => setPicker({ mode: 'move', ...selectedSplit }),
                        disabled: hasManaged(selectedSplit)
                          ? translate('systemFolderTip')
                          : undefined,
                        write: true,
                      },
                      ...(ai.available
                        ? [
                            {
                              label: translate('extractWithAI'),
                              icon: <Sparkles />,
                              onClick: () => setExtracting(selectedSplit.files),
                              disabled: extractReason(selectedSplit) ?? undefined,
                              write: true,
                            },
                          ]
                        : []),
                      ...(selectedSplit.files.length > 0 && selectedSplit.folders.length === 0
                        ? [
                            {
                              label: translate('copyTo'),
                              icon: <Copy />,
                              onClick: () => setPicker({ mode: 'copy', ...selectedSplit }),
                              write: true,
                            },
                          ]
                        : []),
                      {
                        label: translate('moveToTrash'),
                        icon: <Trash2 />,
                        destructive: true,
                        onClick: () => void trashItems(selectedSplit),
                        disabled: hasManaged(selectedSplit)
                          ? translate('systemFolderTip')
                          : undefined,
                        write: true,
                      },
                    ]}
                  />
                )}
              </div>
            </PageContextMenu>
          )}
          {view.section === 'trash' && trashSelected.size > 0 && (
            <BulkBar
              count={trashSelected.size}
              onClear={() => setTrashSelected(new Set())}
              actions={[
                {
                  label: translate('restore'),
                  icon: <RotateCcw />,
                  onClick: () =>
                    restoreFromTrash(trashItemsList.filter((item) => trashSelected.has(item.id))),
                  write: true,
                },
                ...(canDelete
                  ? [
                      {
                        label: translate('deleteForever'),
                        icon: <Trash2 />,
                        destructive: true,
                        onClick: () =>
                          setConfirm({
                            kind: 'delete',
                            items: trashItemsList.filter((item) => trashSelected.has(item.id)),
                          }),
                        write: true,
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>

        {desktopDrag && (
          <div className="pointer-events-none fixed inset-0 z-30 flex items-end justify-center p-8 md:pl-[calc(var(--sidebar-width,16rem)+1rem)]">
            <div className="absolute inset-2 animate-in drop-zone duration-150 fade-in" />
            <div className="relative flex animate-in items-center gap-3 rounded-xl bg-zinc-900 px-5 py-3 text-[15px] text-white shadow-elevation-2 duration-200 slide-in-from-bottom-2 dark:bg-zinc-800">
              <UploadIcon className="size-[18px]" />
              {translate('dropToUploadTo')}
              <span className="font-medium">{folderName(current)}</span>
              <span className="text-white/60">{translate('orOntoAFolder')}</span>
            </div>
          </div>
        )}
      </div>

      <UploadTray uploads={uploads.uploads} act={uploads.act} />
      {importDrawer.isOpen && <ImportDrawer kind="auto" onClose={importDrawer.close} />}
      {extracting && (
        <ImportDrawer
          key={extracting.join()}
          kind="auto"
          documents={extracting}
          onClose={() => setExtracting(null)}
        />
      )}

      {shareFrom && <ShareDrawer file={shareFrom} onClose={() => setShareFrom(null)} />}
      {signFrom !== undefined && (
        <CreateSignatureDrawer
          initial={signFrom}
          folderId={view.section === 'files' ? current : null}
          onClose={() => setSignFrom(undefined)}
          onSent={(id) => {
            setSignFrom(undefined)
            navigate({ section: 'signatures', folder: null, file: null, request: id }, true)
          }}
        />
      )}
      {editing && (
        <TemplateEditor
          template={editing.template}
          initialDocument={editing.document}
          folderId={view.section === 'files' ? current : null}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            if (view.section !== 'templates') openSection('templates')
          }}
        />
      )}
      {filling !== undefined && (
        <FillTemplateDrawer
          template={filling}
          client={null}
          onClose={() => setFilling(undefined)}
        />
      )}
      {view.request && (
        <RequestDrawer id={view.request} onClose={() => navigate({ request: null })} />
      )}
      {view.file && (
        <Preview
          id={view.file}
          siblings={view.section === 'trash' ? [] : files}
          commands={previewCommands}
          onNavigate={(id) => navigate({ file: id })}
          onClose={() => navigate({ file: null })}
        />
      )}
      {newFolderIn !== undefined && (
        <NewFolderDialog
          parentName={folderName(newFolderIn)}
          onCreate={createFolder}
          onClose={() => setNewFolderIn(undefined)}
        />
      )}
      {picker && (
        <FolderPickerDialog
          title={
            picker.mode === 'move'
              ? translate('move', {
                  value1: plural(picker.files.length + picker.folders.length, 'item'),
                })
              : translate('copy3', { value1: plural(picker.files.length, 'file') })
          }
          action={picker.mode === 'move' ? 'Move' : 'Copy'}
          folders={allFolders}
          initial={current}
          moving={picker.mode === 'move' ? picker.folders : []}
          onClose={() => setPicker(null)}
          onPick={(target) => {
            setPicker(null)
            if (picker.mode === 'move') void move(picker, target)
            else void copyFiles(picker.files, target)
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          key={confirm.kind}
          tone="destructive"
          title={
            confirm.kind === 'empty'
              ? translate('emptyTheTrash')
              : translate('deleteForever2', {
                  value1:
                    confirm.items.length === 1
                      ? `“${confirm.items[0]?.name}”`
                      : plural(confirm.items.length, 'item'),
                })
          }
          body={
            confirm.kind === 'empty'
              ? translate('willBeDeletedForGoodBusinessRecordsStayThis', {
                  value1: plural(trashItemsList.length, 'item'),
                })
              : translate('theyAreDeletedForGoodWithEverythingInsideThem')
          }
          confirmLabel={
            confirm.kind === 'empty' ? translate('emptyTrash') : translate('deleteForever')
          }
          onDecide={(approved) => {
            const decided = confirm
            setConfirm(null)
            if (!approved) return
            if (decided.kind === 'delete') deleteForever(decided.items)
            else
              void docsApi.emptyTrash().then(({ data }) => {
                refreshDocuments(queryClient)
                setTrashSelected(new Set())
                toast.success(translate('deletedForever', { value1: plural(data.updated, 'item') }))
              }, docError)
          }}
        />
      )}
    </DropProvider>
  )
}

/** In the grid, the item in the next row up or down that is closest horizontally. */
function verticalNeighbour(
  container: HTMLElement | null,
  order: ItemKey[],
  index: number,
  down: boolean,
) {
  const rectOf = (key: ItemKey | undefined) =>
    key ? container?.querySelector(`[data-key="${key}"]`)?.getBoundingClientRect() : undefined
  const from = rectOf(order[index])
  if (!from) return index
  let best = index
  let bestRow = Infinity
  let bestDx = Infinity
  order.forEach((key, i) => {
    const rect = rectOf(key)
    if (!rect) return
    const dy = down ? rect.top - from.top : from.top - rect.top
    if (dy <= 4) return
    const dx = Math.abs(rect.left - from.left)
    if (dy < bestRow - 4 || (Math.abs(dy - bestRow) <= 4 && dx < bestDx)) {
      best = i
      bestRow = dy
      bestDx = dx
    }
  })
  return best
}

function Breadcrumbs({
  crumbs,
  searching,
  term,
  onOpen,
}: {
  crumbs: Folder[]
  searching: boolean
  term: string
  onOpen: (id: string | null) => void
}) {
  if (searching)
    return (
      <p className="min-w-0 flex-1 truncate px-2 text-[15px]">
        <span className="text-muted-foreground">{translate('resultsFor')}</span>
        <span className="font-medium">“{term.trim()}”</span>
        <span className="text-muted-foreground">{translate('inAllFolders')}</span>
      </p>
    )
  return (
    <nav
      aria-label={translate('breadcrumbs')}
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
    >
      <Crumb target={null} current={crumbs.length === 0} onOpen={onOpen}>
        {translate('allDocuments')}
      </Crumb>
      {crumbs.map((folder, i) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
          <Crumb target={folder.id} current={i === crumbs.length - 1} onOpen={onOpen}>
            {folderLabel(folder)}
          </Crumb>
        </span>
      ))}
    </nav>
  )
}

function Crumb({
  target,
  current,
  onOpen,
  children,
}: {
  target: string | null
  current: boolean
  onOpen: (id: string | null) => void
  children: string
}) {
  const drop = useDropTarget(target)
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      onClick={() => onOpen(target)}
      title={children}
      className="h-8 min-w-0 cursor-pointer truncate rounded-md px-2 text-[15px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground data-drop-over:bg-brand-solid/10 data-drop-over:text-foreground data-drop-over:ring-2 data-drop-over:ring-brand-solid/70"
      {...drop.props}
    >
      {children}
    </button>
  )
}

function ToolbarButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string
  onClick?: () => void
  active?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'size-6.5 cursor-pointer text-muted-foreground hover:bg-transparent',
            // A segment of a view switcher.
            active !== undefined && cn(segmentItem, 'size-6 px-0 dark:hover:bg-transparent'),
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ViewToggle({
  layout,
  onChange,
}: {
  layout: 'grid' | 'list'
  onChange: (layout: 'grid' | 'list') => void
}) {
  return (
    <span className={cn(segmentTrack, 'ml-1 flex')}>
      <ToolbarButton
        label={translate('grid')}
        active={layout === 'grid'}
        onClick={() => onChange('grid')}
      >
        <LayoutGrid />
      </ToolbarButton>
      <ToolbarButton
        label={translate('list')}
        active={layout === 'list'}
        onClick={() => onChange('list')}
      >
        <ListIcon />
      </ToolbarButton>
    </span>
  )
}

function SortMenu({
  view,
  onChange,
}: {
  view: ViewParams
  onChange: (change: Partial<ViewParams>) => void
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer gap-1.5 font-normal text-foreground/80"
            >
              <ArrowDownUp className="stroke-[1.5]" />
              <span className="max-lg:sr-only">{SORT_LABELS[view.sort]}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{translate('sort')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>{translate('sortBy')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={view.sort}
          onValueChange={(value) => {
            const sort = SORT_FIELDS.find((field) => field === value) ?? 'name'
            onChange({ sort, desc: sort !== 'name' && sort !== 'kind' })
          }}
        >
          {SORT_FIELDS.map((field) => (
            <DropdownMenuRadioItem key={field} value={field}>
              {SORT_LABELS[field]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={view.desc ? 'desc' : 'asc'}
          onValueChange={(value) => onChange({ desc: value === 'desc' })}
        >
          <DropdownMenuRadioItem value="asc">{translate('ascending')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">{translate('descending')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** No group chosen: what leaving a grouped view (or clearing the filters) resets. */
/** Starts a download of href in the page (the API answers it as an attachment). */
function saveFile(href: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = ''
  link.click()
}

const NO_GROUP = { type: null, year: null, client: null } satisfies Partial<ViewParams>

/**
 * The search's field terms: `kind:`, `uploaded:`, `by:me` and the groups' `type:`, `year:` and
 * `client:` (a virtual folder is these filters), the Filters popover's choices.
 */
const queryFields = (clients: QueryOption[]): QueryField<ViewParams>[] => [
  ...QUERY_FIELDS,
  {
    id: 'type',
    label: translate('type'),
    type: 'enum',
    values: DOC_TYPES.map((type) => ({ value: type, label: DOC_TYPE_LABELS[type] })),
    placeholder: translate('anyType'),
    ...oneValue(
      (view) => view.type,
      (type) => ({ type: among(DOC_TYPES, type ? [type] : [])[0] ?? null }),
    ),
  },
  {
    id: 'year',
    label: translate('year'),
    type: 'number',
    ...oneValue(
      (view) => (view.year === null ? null : String(view.year)),
      (year) => ({ year: year && /^\d{4}$/.test(year) ? Number(year) : null }),
    ),
  },
  {
    id: 'client',
    label: translate('client'),
    type: 'enum',
    values: clients,
    placeholder: translate('anyClient'),
    ...oneValue(
      (view) => view.client,
      (client) => ({ client }),
    ),
  },
  // Last in the popover, just above "Clear all".
  {
    id: 'by',
    label: translate('byMe'),
    type: 'enum',
    // `by:me`; its chip reads "By me".
    values: [{ value: 'me', label: '' }],
    placeholder: translate('uploadedByMe'),
    get: (view) => (view.mine ? ['me'] : []),
    set: (values) => ({ mine: values.includes('me') }),
  },
]

const QUERY_FIELDS: QueryField<ViewParams>[] = [
  {
    id: 'kind',
    label: translate('kind'),
    type: 'enum',
    values: KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
    placeholder: translate('anyKind'),
    get: (view) => view.kinds,
    set: (kinds) => ({ kinds: among(KINDS, kinds) }),
  },
  {
    id: 'uploaded',
    label: translate('uploaded2'),
    type: 'enum',
    values: sinceOptions(),
    kind: 'date',
    placeholder: translate('uploadedAnyTime'),
    ...oneValue(
      (view) => view.date,
      (date) => ({ date: SINCE_PRESETS.find((preset) => preset === date) ?? null }),
    ),
  },
]

function Filters({
  view,
  fields,
  onChange,
}: {
  view: ViewParams
  fields: QueryField<ViewParams>[]
  onChange: (change: Partial<ViewParams>) => void
}) {
  return (
    <ListFilters
      fields={fields}
      params={view}
      onChange={onChange}
      variant="outline"
      align="end"
      custom={{
        by: (
          <label className="flex h-8 cursor-pointer items-center gap-2.5 px-1 text-sm">
            <Checkbox
              checked={view.mine}
              onCheckedChange={(checked) => onChange({ mine: checked === true })}
            />
            {translate('uploadedByMe')}
          </label>
        ),
      }}
    />
  )
}

function Empty({
  view,
  folderName,
  onUpload,
  onNewFolder,
  onClear,
}: {
  view: ViewParams
  folderName: string
  onUpload: () => void
  onNewFolder: () => void
  onClear: () => void
}) {
  const canWrite = useCan('write:documents')
  if (
    view.search.trim() ||
    view.kinds.length ||
    view.mine ||
    view.date ||
    view.type ||
    view.year ||
    view.client
  )
    return (
      <State
        icon={<SearchX />}
        title={
          view.search.trim()
            ? translate('nothingMatches2', { value1: view.search.trim() })
            : translate('noFilesMatchTheseFilters')
        }
        text={translate('tryAnotherNameOrClearTheSearchAndFilters')}
        action={
          <Button variant="outline" size="sm" className="cursor-pointer" onClick={onClear}>
            {translate('clearSearchAndFilters')}
          </Button>
        }
      />
    )
  if (view.section === 'recent')
    return (
      <State
        icon={<Clock />}
        title={translate('nothingUploadedYet')}
        text={translate('filesYouAndYourTeamUploadShowUpHere')}
        action={
          canWrite && (
            <Button size="sm" className="cursor-pointer" onClick={onUpload}>
              {translate('uploadFiles')}
            </Button>
          )
        }
      />
    )
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="grid max-w-md animate-in justify-items-center text-center duration-300 fade-in slide-in-from-bottom-1">
        <div aria-hidden className="relative mb-8 h-32 w-60">
          <div className="absolute -inset-x-16 -inset-y-10 bg-[radial-gradient(var(--border)_1px,transparent_1px)] mask-[radial-gradient(closest-side,black,transparent)] bg-size-[14px_14px]" />
          <Sheet kind="pdf" className="top-4 left-3 -rotate-[10deg]" />
          <Sheet kind="spreadsheet" className="top-4 right-3 rotate-[10deg]" />
          <Sheet kind="image" className="top-1 left-1/2 -translate-x-1/2" />
          <span className="absolute bottom-0 left-1/2 flex size-14 -translate-x-1/2 items-center justify-center rounded-2xl bg-card shadow-[0_10px_30px_-8px_rgb(0_0_0/0.18),0_2px_6px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] dark:ring-foreground/10">
            <FolderMark className="size-7" />
          </span>
        </div>
        <p className="text-[17px] font-medium tracking-[-0.01em] text-balance">
          {view.folder
            ? translate('isEmpty', { folderName: folderName })
            : translate('yourDocumentsLiveHere')}
        </p>
        <p className="mt-1.5 max-w-sm text-sm text-pretty text-muted-foreground">
          {translate('contractsReceiptsAndStatementsInOnePlaceInFolders')}
        </p>
        {canWrite && (
          <div className="mt-6 flex gap-2">
            <Button size="sm" className="cursor-pointer gap-1.5" onClick={onUpload}>
              <UploadIcon className="size-4" />
              {translate('upload')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer gap-1.5"
              onClick={onNewFolder}
            >
              <FolderPlus className="size-4" />
              {translate('newFolder2')}
            </Button>
          </div>
        )}
        {canWrite && (
          <p className="mt-6 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <MousePointer2 className="size-3.5 stroke-[1.5]" />
            {translate('orDragFilesFromYourComputerAnywhereOntoThis')}
          </p>
        )}
      </div>
    </div>
  )
}

/** A file sheet behind the empty folder: a hint of what lands here. */
function Sheet({ kind, className }: { kind: Kind; className: string }) {
  return (
    <span
      className={cn(
        'absolute grid h-20 w-16 content-between rounded-lg bg-card p-2.5 shadow-elevation-1 ring-1 ring-black/[0.03] dark:ring-foreground/10',
        className,
      )}
    >
      <span className="grid gap-1">
        <span className="h-1 w-9 rounded-full bg-muted" />
        <span className="h-1 w-7 rounded-full bg-muted" />
        <span className="h-1 w-8 rounded-full bg-muted" />
      </span>
      <span
        className={cn(
          'w-fit rounded px-1 text-[9px] leading-4 font-semibold',
          KIND_STYLE[kind].tint,
        )}
      >
        {KIND_STYLE[kind].ext}
      </span>
    </span>
  )
}

function LoadingTree() {
  return <Loader label={translate('loadingFolders')} className="min-h-32" />
}

/**
 * "Create" next to Upload: a document from a template, a PDF for signature, or a folder. Templates
 * themselves are made in the Templates view; with none yet, the first item says so instead.
 */
function CreateMenu({
  templateLock,
  signLock,
  noTemplates,
  onFromTemplate,
  onSign,
  onFolder,
}: {
  templateLock: FeatureLock
  signLock: FeatureLock
  noTemplates: boolean
  onFromTemplate: () => void
  onSign: () => void
  onFolder: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="cursor-pointer gap-1">
          {translate('create')}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuItem
          disabled={Boolean(templateLock) || noTemplates}
          onSelect={onFromTemplate}
          className="items-start py-2"
        >
          <LayoutTemplate className="mt-0.5" />
          <span className="grid gap-0.5">
            <span>{translate('documentFromTemplate')}</span>
            <span className="text-[12px] text-muted-foreground">
              {noTemplates && !templateLock
                ? translate('noTemplatesYetCreateOneInTemplates')
                : translate('aContractOrLetterFilledFromAClient')}
            </span>
          </span>
          {templateLock && <PlanTag lock={templateLock} />}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={Boolean(signLock)}
          onSelect={onSign}
          className="items-start py-2"
        >
          <FileSignature className="mt-0.5" />
          <span className="grid gap-0.5">
            <span>{translate('pdfForSignature')}</span>
            <span className="text-[12px] text-muted-foreground">
              {translate('sendAnyPDFToSignOnline')}
            </span>
          </span>
          {signLock && <PlanTag lock={signLock} />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onFolder}>
          <FolderPlus />
          {translate('newFolder2')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Reads the chosen files with AI into the import drawer's review; disabled with the reason when it cannot. */
