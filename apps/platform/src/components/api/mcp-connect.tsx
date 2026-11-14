'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'

import { Snippet } from '@/components/developers/snippet'

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
        label: 'Claude Code',
        hint: 'Run this in a terminal, then start Claude Code.',
        code: `claude mcp add --transport http helvetly ${url} \\\n  --header "${header}"`,
      },
      {
        id: 'claude-desktop',
        label: 'Claude Desktop',
        hint: 'Settings → Developer → Edit config, add this to claude_desktop_config.json, then restart Claude. Needs Node.js.',
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
        label: 'Cursor',
        hint: 'Add this to ~/.cursor/mcp.json (or .cursor/mcp.json in a project).',
        code: json({
          mcpServers: { helvetly: { url, headers: { Authorization: `Bearer ${token}` } } },
        }),
      },
      {
        id: 'other',
        label: 'Other',
        hint: 'Any client that speaks MCP over Streamable HTTP: this URL, with the token in the Authorization header.',
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
        <p className="text-body-sm font-medium">MCP server URL</p>
        <Snippet label="MCP server URL" value={configs.url} />
      </div>
      <Tabs defaultValue="claude-code" className="min-w-0 gap-2.5">
        <TabsList aria-label="AI assistant" className="h-auto max-w-full flex-wrap justify-start">
          {configs.clients.map((client) => (
            <TabsTrigger key={client.id} value={client.id} className="flex-none px-2.5">
              {client.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {configs.clients.map((client) => (
          <TabsContent key={client.id} value={client.id} className="grid min-w-0 gap-2">
            <p className="text-body-sm text-pretty text-muted-foreground">{client.hint}</p>
            <CodeBlock label={`${client.label} setup`} value={client.code} />
          </TabsContent>
        ))}
      </Tabs>
      {!token && (
        <p className="text-body-sm text-pretty text-muted-foreground">
          Replace <code className="font-mono text-caption text-foreground">{PLACEHOLDER}</code> with
          a token from the list above. The assistant then sees only what the token&apos;s access and
          your role allow.
        </p>
      )}
    </div>
  )
}
