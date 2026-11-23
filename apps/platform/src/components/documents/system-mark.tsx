import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { TruncatedText } from '@helvetly/ui/components/truncated-text'
import { Lock } from 'lucide-react'

import type { Folder, FolderRef } from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { folderLabel, isSystemFolder } from '@/lib/system-folders'

/** The quiet lock of a folder Helvetly manages; it takes its own box, so rows never shift. */
export function SystemMark() {
  const tip = translate('systemFolderTip')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Lock aria-label={tip} className="size-3 shrink-0 stroke-[1.75] text-muted-foreground/70" />
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

/** A folder's shown name (typed system folders translated) with the lock when it is one. */
export function FolderName({
  folder,
  t,
}: {
  folder: Pick<Folder | FolderRef, 'name' | 'system_kind'>
  t?: Parameters<typeof folderLabel>[1]
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <TruncatedText>{folderLabel(folder, t)}</TruncatedText>
      {isSystemFolder(folder) && <SystemMark />}
    </span>
  )
}
