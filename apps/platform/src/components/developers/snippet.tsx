'use client'
import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'

import { translate } from '@/lib/i18n'

/** One line to paste (a header, a command, a secret) in mono, with a copy button. */
export function Snippet({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-lg border bg-muted/50 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 py-1 font-mono text-body-sm break-all">{value}</code>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={translate('copy2', { label: label })}
            onClick={() =>
              void navigator.clipboard.writeText(value).then(
                () => toast(translate('copied', { label: label })),
                () => toast.error(translate('couldNotCopySelectTheTextAndCopyIt')),
              )
            }
          >
            <Copy />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {translate('copy')}
          {label.toLowerCase()}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

/** How a client reaches Helvetly with a token: REST header, MCP endpoint, Claude Code, mcp-remote. */
export function connectSnippets(origin: string, token = 'hvt_…') {
  const mcp = `${origin}/api/mcp`
  const header = `Authorization: Bearer ${token}`
  return {
    header,
    mcp,
    claudeCode: `claude mcp add --transport http helvetly ${mcp} --header "${header}"`,
    mcpRemote: `npx -y mcp-remote ${mcp} --header "${header}"`,
  }
}
