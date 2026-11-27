'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import { BookOpen, Bot, Braces, PlugZap } from 'lucide-react'

import { Snippet } from '@/components/developers/snippet'
import { PageIntro, SettingsSection } from '@/components/settings/layout'
import { PAGE_WIDTH, PageHeader } from '@/components/shell/page-header'
import { useApiOrigin } from '@/lib/api-origin'
import { docsUrl } from '@/lib/docs'
import { translate } from '@/lib/i18n'

import { ApiTokens } from './api-tokens'
import { DocsLink } from './code-block'
import { McpConnect } from './mcp-connect'

/** Each section of the page is a card, its title above its rows, which take the card's whole width (no settings form column). */
export const DEVELOPER_CARD =
  'rounded-xl border bg-card p-5 [--settings-form:100%] first:border first:pt-5 sm:p-6 sm:first:pt-6'

/** API & MCP (its own page under Ask Heidi): personal tokens, connecting an AI assistant and the REST API. */
export function DevelopersPage() {
  const origin = useApiOrigin()
  return (
    <>
      <PageHeader
        tabs={[translate('apiMCP')]}
        tabIcons={[PlugZap]}
        savedViews={false}
        actions={
          <Button asChild size="sm" variant="outline" title={translate('developerDocs')}>
            <a href={localizedHref(docsUrl())} target="_blank" rel="noreferrer">
              <BookOpen />
              <span className="max-sm:sr-only">{translate('developerDocs')}</span>
              <span className="sr-only">{translate('opensInANewTab')}</span>
            </a>
          </Button>
        }
      />
      <div className="flex-1">
        <div
          className={cn(
            'grid w-full content-start gap-6 px-4 pt-5 pb-24 sm:px-6 md:pt-7 lg:px-8',
            PAGE_WIDTH.normal,
          )}
        >
          <PageIntro
            title={translate('apiMCP')}
            description={translate('connectYourOwnScriptsAndAIAssistantsToHelvetly')}
          />
          <div className="grid min-w-0 gap-4">
            <ApiTokens className={DEVELOPER_CARD} />
            <SettingsSection
              className={DEVELOPER_CARD}
              id="mcp"
              icon={Bot}
              title={translate('connectAnAIAssistant')}
              description={
                <>
                  {translate('claudeCursorAndOtherAssistantsCanUseHelvetlyThrough')}{' '}
                  <DocsLink path="/mcp">{translate('mcpGuide')}</DocsLink>
                </>
              }
            >
              <McpConnect origin={origin} />
            </SettingsSection>
            <SettingsSection
              className={DEVELOPER_CARD}
              id="rest-api"
              icon={Braces}
              title={translate('restAPI')}
              description={
                <>
                  {translate('jsonOverHTTPSTheSameOperationsAsTheMCP')}
                  <DocsLink>{translate('apiReference')}</DocsLink>
                </>
              }
            >
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <p className="text-body-sm font-medium">{translate('baseURL')}</p>
                  <Snippet label={translate('baseURL')} value={`${origin}/api/v1`} />
                </div>
                <div className="grid gap-1.5">
                  <p className="text-body-sm font-medium">{translate('firstRequest')}</p>
                  <Snippet
                    label={translate('exampleRequest')}
                    value={`curl ${origin}/api/v1/clients -H "Authorization: Bearer hvt_YOUR_TOKEN"`}
                  />
                </div>
              </div>
            </SettingsSection>
          </div>
        </div>
      </div>
    </>
  )
}
