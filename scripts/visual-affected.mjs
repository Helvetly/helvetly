import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'

// Which Storybook stories a pull request can change, from each app's built module graph (`storybook build
// --stats-json`): a changed file reaches every story that imports it, however indirectly. The focus audit of
// e2e/visual then opens only those. `null` means every story: a change the graph cannot follow (config,
// dependencies, the preview, the audit itself) fails open, as scripts/ci.mjs does.

export const apps = ['platform', 'portal']

/** Story ids per app that `paths` (repository-relative) reach, or null for all of them. */
export function affectedStories(paths, graphs) {
  const result = {}
  const reached = Object.fromEntries(apps.map((app) => [app, new Set()]))
  for (const path of paths) {
    // The audit's own code; screenshots and stories.spec.ts do not change what it finds.
    const audit =
      /^e2e\/visual\/(focus-layout\.spec\.ts|storybook\.ts|playwright\.config\.ts|run\.sh|serve\.mjs)$/
    if (
      audit.test(path) ||
      /^(scripts\/visual-affected\.mjs|package\.json|pnpm-.*|apps\/[a-z]+\/\.storybook\/.*)$/.test(
        path,
      )
    )
      return null
    if (!/^(apps\/(platform|portal)|packages\/ui)\//.test(path)) continue
    if (/\.test\.tsx?$/.test(path)) continue
    let known = false
    for (const app of apps) {
      const { importers } = graphs[app]
      if (!importers.has(path)) continue
      known = true
      // What the preview imports itself (styles, fonts, providers, decorators) wraps every story. Further down,
      // the preview's decorators reach most of the app, but only render it where a story's own code opens it
      // (a drawer opened through `useRecordDrawers`), so the walk goes on through the other importers instead.
      const preview = (file) => file.startsWith(`apps/${app}/.storybook/`)
      if (importers.get(path).some(preview)) return null
      const seen = reached[app]
      const queue = [path]
      while (queue.length) {
        const file = queue.pop()
        if (seen.has(file) || preview(file)) continue
        seen.add(file)
        queue.push(...(importers.get(file) ?? []))
      }
    }
    // A file of the apps no story bundle contains: config, a route, a script. Not worth guessing about.
    if (
      !known &&
      !path.startsWith('apps/platform/src/app/') &&
      !path.startsWith('apps/portal/src/app/')
    )
      return null
  }
  for (const app of apps)
    result[app] = graphs[app].stories
      .filter((story) => reached[app].has(story.file))
      .map((story) => story.id)
  return result
}

/** One app's graph: repository-relative file -> the files that import it, and its stories' files. */
export function readGraph(app, root) {
  const dir = join(root, 'apps', app, 'storybook-static')
  const at = (name) => normalize(join('apps', app, name))
  const importers = new Map()
  for (const entry of JSON.parse(readFileSync(join(dir, 'preview-stats.json'), 'utf8')).modules)
    importers.set(
      at(entry.name),
      entry.reasons.map((reason) => at(reason.moduleName)),
    )
  const stories = Object.values(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).entries)
    .filter((entry) => entry.type === 'story')
    .map((entry) => ({ id: entry.id, file: at(entry.importPath) }))
  return { importers, stories }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // node scripts/visual-affected.mjs <base sha> <out file>: writes the story ids, or nothing for all.
  const [base, out] = process.argv.slice(2)
  const paths = execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', base, 'HEAD', '--'],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(Boolean)
  const graphs = Object.fromEntries(apps.map((app) => [app, readGraph(app, process.cwd())]))
  const stories = affectedStories(paths, graphs)
  if (stories) writeFileSync(out, JSON.stringify(stories))
  console.log(
    stories
      ? `Focus audit of ${apps.map((app) => `${stories[app].length} ${app}`).join(' and ')} stories.`
      : 'Focus audit of every story.',
  )
}
