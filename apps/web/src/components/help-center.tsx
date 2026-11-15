'use client'

import { HeidiOrb } from '@helvetly/ui/components/heidi-mark'
import { ArrowRight, BookOpen, Search, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { categoryLabel } from '@/lib/categories'
import { cn } from '@/lib/cn'
import { helpTopic, HELP_TOPICS, POPULAR_HELP, topicSlug } from '@/lib/help-topics'
import { translate } from '@/lib/i18n'
import { TONES } from '@/lib/tones'

export type HelpEntry = { slug: string; title: string; description: string; category: string }

const QUICK = [
  translate('qrBill'),
  'reminder',
  translate('vatReturn'),
  'passkey',
  'import',
  'invite',
]

function TopicIcon({ category, size = 'md' }: { category: string; size?: 'sm' | 'md' }) {
  const topic = helpTopic(category)
  const Icon = topic?.icon ?? BookOpen
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-white',
        TONES[topic?.tone ?? 'sky'].solid,
        size === 'md' ? 'size-11 rounded-2xl' : 'size-8 rounded-xl',
      )}
    >
      <Icon aria-hidden className={size === 'md' ? 'size-5' : 'size-4'} />
    </span>
  )
}

function ArticleRow({ entry }: { entry: HelpEntry }) {
  return (
    <Link
      href={`/help/${entry.slug}`}
      className="group border-site-line flex items-start gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-foreground/20"
    >
      <TopicIcon category={entry.category} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium underline-offset-4 group-hover:underline">
          {entry.title}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-body-sm text-muted-foreground">
          {entry.description}
        </span>
      </span>
      <ArrowRight
        aria-hidden
        className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  )
}

/** The help center below its title: one search box, then topics and popular articles, or the matches. */
export function HelpCenter({ entries }: { entries: HelpEntry[] }) {
  const [query, setQuery] = useState('')
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = entries.filter((e) =>
    words.every((w) => `${e.title} ${e.description} ${e.category}`.toLowerCase().includes(w)),
  )
  const popular = POPULAR_HELP.flatMap((slug) => entries.filter((e) => e.slug === slug))

  return (
    <>
      <div className="mx-auto max-w-2xl">
        <label className="relative flex items-center">
          <span className="sr-only">{translate('searchTheHelpCenter')}</span>
          <Search aria-hidden className="absolute left-5 size-5 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate('searchForAnAnswer')}
            className="text-lead h-14 w-full rounded-full border border-foreground/15 bg-card pr-12 pl-13 shadow-[0_20px_50px_-30px_rgb(85_39_201/0.45)] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={translate('clearTheSearch')}
              className="hover:bg-site-tint absolute right-4 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </label>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-body-sm">
          <span className="text-muted-foreground">{translate('popular')}</span>
          {QUICK.map((word) => (
            <button
              key={word}
              type="button"
              onClick={() => setQuery(word)}
              className="border-site-line hover:border-lilac-solid/40 hover:bg-lilac rounded-full border bg-card/70 px-3 py-1 text-foreground/80 transition-colors hover:text-foreground"
            >
              {word}
            </button>
          ))}
        </div>
      </div>

      {words.length > 0 ? (
        <section aria-live="polite" className="mx-auto mt-14 max-w-3xl">
          <h2 className="text-body-sm text-muted-foreground">
            {matches.length === 0
              ? translate('nothingMatches', { query: query })
              : translate('for', {
                  length: matches.length,
                  value2: matches.length === 1 ? 'answer' : 'answers',
                  query: query,
                })}
          </h2>
          {matches.length === 0 ? (
            <p className="mt-3 text-body text-muted-foreground">
              {translate('tryAnotherWordOrPressJInsideHelvetlyAnd')}
            </p>
          ) : (
            <div className="mt-4 grid gap-3">
              {matches.map((entry) => (
                <ArticleRow key={entry.slug} entry={entry} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby="help-topics" className="mt-16">
            <h2 id="help-topics" className="sr-only">
              {translate('topics')}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {HELP_TOPICS.map((topic) => {
                const count = entries.filter((e) => e.category === topic.name).length
                if (count === 0) return null
                return (
                  <Link
                    key={topic.name}
                    href={`/help/topic/${topicSlug(topic.name)}`}
                    className={cn(
                      'group flex flex-col rounded-3xl border p-5 transition-colors hover:border-foreground/20',
                      TONES[topic.tone].tile,
                      TONES[topic.tone].border,
                    )}
                  >
                    <TopicIcon category={topic.name} />
                    <span className="mt-4 text-title-sm font-semibold underline-offset-4 group-hover:underline">
                      {categoryLabel(topic.name)}
                    </span>
                    <span className="mt-1 flex-1 text-body-sm text-muted-foreground">
                      {topic.blurb}
                    </span>
                    <span
                      className={cn(
                        'mt-4 inline-flex items-center gap-1 text-body-sm font-medium',
                        TONES[topic.tone].ink,
                      )}
                    >
                      {count} {count === 1 ? 'article' : 'articles'}
                      <ArrowRight
                        aria-hidden
                        className="size-3.5 transition-transform group-hover:translate-x-0.5"
                      />
                    </span>
                  </Link>
                )
              })}
            </div>
          </section>

          <section aria-labelledby="help-popular" className="mt-20">
            <h2 id="help-popular" className="text-title font-semibold">
              {translate('popularArticles')}
            </h2>
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {popular.map((entry) => (
                <ArticleRow key={entry.slug} entry={entry} />
              ))}
            </div>
          </section>
        </>
      )}

      <section className="night dark relative mt-20 overflow-hidden rounded-3xl p-8 text-white sm:p-10">
        <div aria-hidden className="beams beam absolute -top-1/2 -right-1/4 size-[40rem]" />
        <div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          <HeidiOrb className="size-16 shrink-0" />
          <div className="flex-1">
            <h2 className="text-title font-semibold">{translate('stillStuckAskHeidi')}</h2>
            <p className="mt-1 max-w-xl text-body text-white/70">
              {translate('insideHelvetlyPressJOnAnyPageAndAsk2')}
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
