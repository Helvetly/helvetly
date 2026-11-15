'use client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'

import { Snippet } from '@/components/developers/snippet'
import { translate } from '@/lib/i18n'

import { CodeBlock } from './code-block'

const PLACEHOLDER = 'hvt_YOUR_TOKEN'
const json = (value: unknown) => JSON.stringify(value, null, 2)

/** Ready-to-paste MCP setups, with the token filled in when there is one. */
export function mcpConfigs(origin: string, token = PLACEHOLDER) {
  const url = `${origin}/api/mcp`
  const header = `Authorization: Bearer ${token}`
  return {
    url,
    header,
    clients: [
      {
        id: 'claude-code',
        label: translate('claudeCode'),
        hint: translate('runThisInATerminalThenStartClaudeCode'),
        code: `claude mcp add --transport http helvetly ${url} \\\n  --header "${header}"`,
      },
      {
        id: 'claude-desktop',
        label: translate('claudeDesktop'),
        hint: translate('settingsDeveloperEditConfigAddThisToClaudeDesktop'),
        code: json({
          mcpServers: {
            helvetly: {
              command: 'npx',
              args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${AUTH_HEADER}'],
              env: { AUTH_HEADER: `Bearer ${token}` },
            },
          },
        }),
      },
      {
        id: 'cursor',
        label: translate('cursor'),
        hint: translate('addThisToCursorMcpJsonOrCursorMcp'),
        code: json({
          mcpServers: { helvetly: { url, headers: { Authorization: `Bearer ${token}` } } },
        }),
      },
      {
        id: 'other',
        label: translate('other'),
        hint: translate('anyClientThatSpeaksMCPOverStreamableHTTPThis'),
        code: `URL:    ${url}\nHeader: ${header}`,
      },
    ],
  }
}

/**
 * How to connect an AI assistant to Helvetly's MCP server: the endpoint to copy and a setup per client.
 * Without `token` the snippets carry a placeholder to replace.
 */
export function McpConnect({ origin, token }: { origin: string; token?: string }) {
  const configs = mcpConfigs(origin, token)
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-1.5">
        <p className="text-body-sm font-medium">{translate('mcpServerURL')}</p>
        <Snippet label={translate('mcpServerURL')} value={configs.url} />
      </div>
      <Tabs defaultValue="claude-code" className="min-w-0 gap-2.5">
        <TabsList
          aria-label={translate('aiAssistant')}
          className="h-auto max-w-full flex-wrap justify-start"
        >
          {configs.clients.map((client) => (
            <TabsTrigger key={client.id} value={client.id} className="flex-none px-2.5">
              {client.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {configs.clients.map((client) => (
          <TabsContent key={client.id} value={client.id} className="grid min-w-0 gap-2">
            <p className="text-body-sm text-pretty text-muted-foreground">{client.hint}</p>
            <CodeBlock label={translate('setup', { label: client.label })} value={client.code} />
          </TabsContent>
        ))}
      </Tabs>
      {!token && (
        <p className="text-body-sm text-pretty text-muted-foreground">
          {translate('replace')}
          <code className="font-mono text-caption text-foreground">{PLACEHOLDER}</code>
          {translate('withATokenFromTheListAboveTheAssistant')}
        </p>
      )}
    </div>
  )
}
