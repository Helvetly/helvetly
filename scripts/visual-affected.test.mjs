import assert from 'node:assert/strict'
import { test } from 'node:test'

import { affectedStories } from './visual-affected.mjs'

// platform: preview imports globals.css and the drawers decorator; the drawers render client-detail, which a
// row component opens through the drawers' hook. portal: one story of its own.
const graphs = {
  platform: {
    importers: new Map([
      ['packages/ui/src/styles/globals.css', ['apps/platform/.storybook/preview.tsx']],
      [
        'packages/ui/src/components/button.tsx',
        ['apps/platform/src/components/clients/client-detail.tsx'],
      ],
      [
        'apps/platform/src/components/clients/client-detail.tsx',
        ['apps/platform/src/components/record-drawers.tsx'],
      ],
      [
        'apps/platform/src/components/record-drawers.tsx',
        ['apps/platform/.storybook/preview.tsx', 'apps/platform/src/components/client-row.tsx'],
      ],
      [
        'apps/platform/src/components/client-row.tsx',
        ['apps/platform/src/components/client-row.stories.tsx'],
      ],
      ['apps/platform/src/components/client-row.stories.tsx', []],
      [
        'apps/platform/src/components/other.tsx',
        ['apps/platform/src/components/other.stories.tsx'],
      ],
      ['apps/platform/src/components/other.stories.tsx', []],
    ]),
    stories: [
      { id: 'client-row--default', file: 'apps/platform/src/components/client-row.stories.tsx' },
      { id: 'client-row--dark', file: 'apps/platform/src/components/client-row.stories.tsx' },
      { id: 'other--default', file: 'apps/platform/src/components/other.stories.tsx' },
    ],
  },
  portal: {
    importers: new Map([
      ['packages/ui/src/components/button.tsx', ['apps/portal/src/components/shell.stories.tsx']],
      ['apps/portal/src/components/shell.stories.tsx', []],
    ]),
    stories: [{ id: 'shell--default', file: 'apps/portal/src/components/shell.stories.tsx' }],
  },
}

test('a change reaches the stories that import it, however indirectly, and not through the preview', () => {
  for (const [paths, expected] of [
    [['apps/platform/src/components/other.tsx'], { platform: ['other--default'], portal: [] }],
    [
      ['apps/platform/src/components/clients/client-detail.tsx'],
      { platform: ['client-row--default', 'client-row--dark'], portal: [] },
    ],
    [
      ['packages/ui/src/components/button.tsx'],
      { platform: ['client-row--default', 'client-row--dark'], portal: ['shell--default'] },
    ],
    [['apps/api/internal/auth/auth.go', 'README.md'], { platform: [], portal: [] }],
    [['apps/platform/src/components/other.test.tsx'], { platform: [], portal: [] }],
    [['apps/platform/src/app/(app)/page.tsx'], { platform: [], portal: [] }],
    [
      ['e2e/visual/__screenshots__/x.png', 'e2e/visual/stories.spec.ts'],
      { platform: [], portal: [] },
    ],
  ])
    assert.deepEqual(affectedStories(paths, graphs), expected, paths.join(', '))
})

test('what wraps every story, the audit itself and unknown frontend files select every story', () => {
  for (const paths of [
    ['packages/ui/src/styles/globals.css'],
    ['apps/platform/src/components/record-drawers.tsx'],
    ['apps/platform/.storybook/preview.tsx'],
    ['e2e/visual/focus-layout.spec.ts'],
    ['e2e/visual/field-surface.spec.ts'],
    ['e2e/visual/new-audit.spec.ts'],
    ['packages/i18n/src/locales.json'],
    ['e2e/visual/storybook.ts'],
    ['scripts/visual-affected.mjs'],
    ['pnpm-lock.yaml'],
    ['package.json'],
    ['apps/platform/next.config.ts'],
    ['packages/ui/src/components/unused.tsx'],
    ['apps/platform/src/components/other.tsx', 'apps/portal/vite.config.ts'],
  ])
    assert.equal(affectedStories(paths, graphs), null, paths.join(', '))
})
